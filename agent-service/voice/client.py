"""LiveKit voice presence - full duplex (mirrors src/voice/voiceClient.ts).

Joins the room's LiveKit call as a listener, transcribes remote speech via
VAD segmentation + STT backends, and publishes TTS audio when the owner
has invited the agent to speak.  Degrades to a disconnected stub when the
``livekit`` package is not installed so the board keeps working without voice.

Key fixes vs. scaffold:
- ``join`` actually calls ``await room.connect(url, token)`` and only sets
  ``connected=True`` after a successful connect (was True without connecting).
- ``_publish`` actually publishes PCM to the room via ``AudioSource`` /
  ``LocalAudioTrack`` (was synthesize+log only).
- Remote audio is consumed via ``AudioStream`` -> ``UtteranceSegmenter`` ->
  ``transcribe_utterance_blocking`` -> ``on_transcript`` (was no feeding).
- ``livekit`` is a real dependency in ``requirements.txt`` (was commented out).
- TTS is streamed from ``voice.tts`` (local piper by default, edge-tts as
  fallback), so the room hears the opening words while the rest synthesizes.
- mp3 decode runs in-process via PyAV, so no system ffmpeg is required.
- ``speak`` reports the *real* publish outcome so callers can fall back to chat.
- ``can_speak`` is seeded from the token response, so a restarted agent keeps a
  standing voice invite instead of silently going mute forever.
- a supervisor rejoins with backoff and refreshes the 1h token.
"""

from __future__ import annotations

import asyncio
import io
import queue
import random
import subprocess
import threading
import time

import config
from logger import logger

SAMPLE_RATE = 48000
CHANNELS = 1
SAMPLES_PER_FRAME = 480  # 10ms @ 48kHz mono
BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2  # s16le
MAX_SPEAK_CHARS = 1000
# Jitter cushion in LiveKit's AudioSource queue. capture_frame blocks once this
# much audio is buffered, so LiveKit paces publishing in real time while we stay
# up to a second ahead of the listener — enough to cover the gap while piper
# synthesizes the next sentence.
AUDIO_QUEUE_MS = 1000
# Grace period for the echo guard while synthesis is still running and no
# audio length is known yet. Extended per published frame afterwards.
SYNTH_GRACE_S = 40.0
# How long speak() waits to learn whether audio reached the room. It resolves
# on the FIRST published frame, not on full playout: publishing is paced in
# real time, so waiting for the tail would burn the caller's reasoning timeout
# for no extra information.
SPEAK_RESULT_TIMEOUT_S = 50.0
# Ceiling for one utterance on the voice loop, including real-time playout.
PUBLISH_TIMEOUT_S = 180.0
# Backend mints 1h LiveKit tokens; refresh well before that so a long lesson
# never drops out of voice mid-sentence.
TOKEN_REFRESH_S = 45 * 60
RECONNECT_BASE_DELAY_S = 2.0
RECONNECT_MAX_DELAY_S = 60.0


def _decode_pyav(mp3: bytes) -> bytes:
    """Decode mp3 -> 48kHz mono s16le in-process via PyAV.

    Preferred over the ffmpeg subprocess: PyAV ships its own ffmpeg libraries,
    so local dev works without a system ffmpeg on PATH (the Windows dev boxes
    have none, which made every speak() fail with FileNotFoundError).
    """
    import av  # type: ignore

    container = av.open(io.BytesIO(mp3), mode="r")
    try:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        out: list[bytes] = []
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                out.append(resampled.to_ndarray().tobytes())
        # Flush whatever the resampler still buffers.
        try:
            for resampled in resampler.resample(None) or []:
                out.append(resampled.to_ndarray().tobytes())
        except Exception:
            pass
        return b"".join(out)
    finally:
        try:
            container.close()
        except Exception:
            pass


def _decode_ffmpeg(mp3: bytes) -> bytes:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
         "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
        input=mp3, capture_output=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode()[:300])
    return proc.stdout


def _decode_to_pcm48k(mp3: bytes) -> bytes:
    """PyAV first, ffmpeg subprocess as fallback. Raises when both fail."""
    errors: list[str] = []
    for name, decode in (("pyav", _decode_pyav), ("ffmpeg", _decode_ffmpeg)):
        try:
            pcm = decode(mp3)
            if pcm:
                return pcm
            errors.append(f"{name}: produced no audio")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{name}: {exc}")
    raise RuntimeError("mp3 decode failed (" + "; ".join(errors)[:400] + ")")


# Public alias for voice.tts (the edge-tts backend needs mp3 -> 48k PCM).
decode_mp3_to_pcm48k = _decode_to_pcm48k


def is_livekit_available() -> bool:
    try:
        from livekit import rtc  # noqa: F401  # type: ignore
        return True
    except ImportError:
        return False


class AgentVoiceClient:
    def __init__(self):
        self.connected = False
        self.can_speak = False
        self.on_transcript = None
        self._room = None
        self._room_id: str | None = None
        self._audio_source = None
        self._audio_track = None
        self._queue: queue.Queue = queue.Queue(maxsize=3)
        self._pumping = False
        self._suppress_until = 0.0
        self._generation = 0
        self._transcribing = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        # Set once the owner explicitly invites/uninvites over the socket. Until
        # then the token's `invited` flag (durable Redis publisher state) is the
        # source of truth, so a restarted agent keeps a standing invite.
        self._invite_pinned = False
        self._token_fetched_at = 0.0
        self._supervisor: threading.Thread | None = None
        self._supervisor_stop = threading.Event()

    @property
    def state(self) -> str:
        if not self.connected:
            return "disconnected"
        return "speaking-enabled" if self.can_speak else "listening"

    # -- loop management --

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is not None and not self._loop.is_closed():
            return self._loop
        loop = asyncio.new_event_loop()

        def _run() -> None:
            asyncio.set_event_loop(loop)
            loop.run_forever()

        t = threading.Thread(target=_run, daemon=True, name="voice-loop")
        t.start()
        self._loop = loop
        self._loop_thread = t
        # give loop a moment to start
        time.sleep(0.05)
        return loop

    def _stop_loop(self) -> None:
        # Loop is shared across join/leave cycles; keep it alive for reuse so
        # an in-flight publish/disconnect on the same loop is never orphaned
        # by a concurrent leave(). Process exit cleans up the daemon thread.
        return

    def _shutdown_loop(self) -> None:  # pragma: no cover — process-teardown only
        loop = self._loop
        if loop is None:
            return
        try:
            loop.call_soon_threadsafe(loop.stop)
        except Exception:
            pass
        try:
            if self._loop_thread is not None:
                self._loop_thread.join(timeout=2.0)
        except Exception:
            pass
        try:
            if not loop.is_closed():
                loop.close()
        except Exception:
            pass
        self._loop = None
        self._loop_thread = None

    # -- lifecycle --

    def join(self, room_id: str, supervise: bool = True) -> bool:
        if self.connected and self._room is not None and self._room_id == room_id:
            return True
        if self.connected and self._room is not None and self._room_id != room_id:
            # Switching rooms: tear down the stale session first.
            self.leave()
        try:
            from http_client import backend_post
            status, data = backend_post("/api/internal/agent/voice-token", {"roomId": room_id}, timeout_s=10)
            if status != 200:
                logger.warning("voice token fetch failed room=%s status=%s", room_id, status)
                return False
            url, token = (data or {}).get("url"), (data or {}).get("token")
            if not url or not token:
                logger.warning("voice token response incomplete room=%s", room_id)
                return False
            # Durable invite state from the backend's Redis publisher set. The
            # `voice:invited` socket event only reaches sockets that were live
            # at invite time, so without this seed a restarted (or late-joining)
            # agent can never speak again until someone re-invites it.
            invited = (data or {}).get("invited")
            try:
                from livekit import rtc as livekit_rtc  # type: ignore
            except ImportError:
                logger.warning("livekit not installed — voice stays disconnected, board still works")
                return False

            loop = self._ensure_loop()
            fut = asyncio.run_coroutine_threadsafe(self._async_join(url, token, room_id, livekit_rtc), loop)
            try:
                ok = fut.result(timeout=15)
            except Exception as exc:
                logger.warning("voice join failed room=%s: %s", room_id, exc)
                return False
            if ok:
                self._token_fetched_at = time.time()
                # An explicit socket invite/uninvite always wins over the seed:
                # the owner may have acted while we were reconnecting.
                if isinstance(invited, bool) and not self._invite_pinned:
                    self.can_speak = invited
                logger.info("voice joined LiveKit room=%s canSpeak=%s", room_id, self.can_speak)
                if supervise:
                    self._ensure_supervisor()
            return ok
        except Exception as exc:  # noqa: BLE001
            logger.warning("voice join failed room=%s: %s", room_id, exc)
            return False

    async def _async_join(self, url: str, token: str, room_id: str, rtc) -> bool:
        # called on self._loop
        room = rtc.Room(loop=asyncio.get_running_loop())
        generation = self._generation

        @room.on("disconnected")
        def _on_disconnected(reason=None):  # noqa: ANN001
            # Only mark disconnected if this generation is still current
            if generation != self._generation:
                return
            self.connected = False
            logger.info("voice LiveKit disconnected room=%s reason=%s", room_id, reason)

        @room.on("track_subscribed")
        def _on_track_subscribed(track, publication, participant):  # noqa: ANN001
            if generation != self._generation:
                return
            try:
                # schedule consumption on the same loop
                asyncio.get_running_loop().create_task(
                    self._consume_remote_audio(track, participant, room_id, rtc)
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("track_subscribed handler failed room=%s: %s", room_id, exc)

        try:
            await room.connect(url, token)
        except Exception as exc:  # noqa: BLE001
            logger.warning("LiveKit connect failed room=%s: %s", room_id, exc)
            try:
                await room.disconnect()
            except Exception:
                pass
            return False

        if generation != self._generation:
            # leave() raced the connect; drop the stale room.
            try:
                await room.disconnect()
            except Exception:
                pass
            return False

        self._room = room
        self._room_id = room_id
        # A fresh room means the previous local track is gone with it; drop the
        # stale AudioSource so _ensure_published republishes on this room.
        self._audio_source = None
        self._audio_track = None
        self._suppress_until = 0.0
        self.connected = True

        # handle tracks that were already published before we connected
        try:
            for _identity, participant in list(room.remote_participants.items()):
                for _tid, pub in list(participant.track_publications.items()):
                    track = getattr(pub, "track", None)
                    if track is not None:
                        try:
                            if getattr(track, "kind", None) == rtc.TrackKind.KIND_AUDIO:
                                asyncio.get_running_loop().create_task(
                                    self._consume_remote_audio(track, participant, room_id, rtc)
                                )
                        except Exception:
                            pass
        except Exception:
            pass

        return True

    def leave(self) -> None:
        self._generation += 1
        self._supervisor_stop.set()
        self._supervisor = None
        self.can_speak = False
        self._invite_pinned = False
        self._transcribing = False
        self._token_fetched_at = 0.0
        self._drain_queue("voice_left")
        # capture fields for async disconnect
        room = self._room
        loop = self._loop
        self._room = None
        self._room_id = None
        self._audio_source = None
        self._audio_track = None
        self.connected = False
        if room is not None and loop is not None and not loop.is_closed():
            try:
                fut = asyncio.run_coroutine_threadsafe(room.disconnect(), loop)
                try:
                    fut.result(timeout=5)
                except Exception:
                    pass
            except Exception:
                pass
        # NOTE: the background loop is intentionally kept alive for the next
        # join() — stopping it here would orphan an in-flight publish on the
        # same loop and force a thread churn on every room switch.
        logger.info("voice left LiveKit")

    def _drain_queue(self, reason: str) -> None:
        """Fail every queued utterance so no speak() caller waits forever."""
        while True:
            try:
                item = self._queue.get_nowait()
            except queue.Empty:
                return
            self._settle(item, {"delivered": False, "reason": reason})

    def set_invited(self, invited: bool, room_id: str) -> None:
        was = self.can_speak
        self.can_speak = invited
        # An explicit owner decision outranks the token seed from here on.
        self._invite_pinned = True
        logger.info("voice invite state changed room=%s canSpeak=%s", room_id, invited)
        # If we were just invited but are still on a pre-invite LiveKit token
        # (canPublish=false), the next publish will time out with
        # "track publication timed out, no response received from the server".
        # The frontend solves this by re-fetching the token on invite; we must
        # do the same. Only reconnect when we transition false->true and we're
        # already connected to the same room.
        if invited and not was and self.connected and self._room_id == room_id:
            threading.Thread(target=self._rejoin_after_invite, args=(room_id,), daemon=True).start()

    def _rejoin_after_invite(self, room_id: str) -> None:
        # Small delay to let the backend's Redis write (setVoicePublisher) settle
        time.sleep(0.3)
        if not self.can_speak or self._room_id != room_id:
            return
        logger.info("voice re-joining for publish permission room=%s", room_id)
        self._reset_room()
        ok = self.join(room_id)
        if not ok:
            logger.warning("voice re-join after invite failed room=%s", room_id)

    # -- reconnect supervision --

    def _ensure_supervisor(self) -> None:
        t = self._supervisor
        if t is not None and t.is_alive():
            return
        with self._lock:
            t = self._supervisor
            if t is not None and t.is_alive():
                return
            self._supervisor_stop = threading.Event()
            self._supervisor = threading.Thread(
                target=self._supervise, daemon=True, name="voice-supervisor")
            self._supervisor.start()

    def _supervise(self) -> None:
        """Rejoin on disconnect and refresh the token before it expires.

        The backend mints 1h LiveKit tokens and ``_on_disconnected`` only flips
        a flag — without this, any transient LiveKit blip or a lesson longer
        than the TTL loses voice permanently while the board keeps working.
        """
        stop = self._supervisor_stop
        attempt = 0
        while not stop.wait(RECONNECT_BASE_DELAY_S):
            room_id = self._room_id
            if room_id is None:
                return
            try:
                if not self.connected:
                    attempt += 1
                    delay = min(RECONNECT_MAX_DELAY_S,
                                RECONNECT_BASE_DELAY_S * (2 ** min(attempt - 1, 5)))
                    delay += random.uniform(0, delay * 0.25)  # jitter
                    logger.info("voice reconnecting room=%s attempt=%s in %.1fs",
                                room_id, attempt, delay)
                    if stop.wait(delay):
                        return
                    if self._room_id != room_id or stop.is_set():
                        return
                    self._reset_room()
                    if self.join(room_id, supervise=False):
                        attempt = 0
                    continue
                attempt = 0
                age = time.time() - (self._token_fetched_at or 0.0)
                if self._token_fetched_at and age >= TOKEN_REFRESH_S:
                    logger.info("voice token nearing expiry room=%s age=%.0fs — reconnecting",
                                room_id, age)
                    self._reset_room()
                    self.join(room_id, supervise=False)
            except Exception as exc:  # noqa: BLE001
                logger.warning("voice supervisor iteration failed room=%s: %s", room_id, exc)

    def _reset_room(self) -> None:
        """Drop the current room without clearing invite state or the supervisor."""
        room = self._room
        loop = self._loop
        self._generation += 1
        self._room = None
        self._audio_source = None
        self._audio_track = None
        self.connected = False
        self._suppress_until = 0.0
        if room is not None and loop is not None and not loop.is_closed():
            try:
                fut = asyncio.run_coroutine_threadsafe(room.disconnect(), loop)
                fut.result(timeout=5)
            except Exception:
                pass

    # -- speaking (TTS -> publish) --

    def speak(self, text: str, room_id: str) -> dict:
        """Synthesize and publish ``text``, returning the *real* outcome.

        Blocks until the first frame of audio has reached the room (or the
        attempt failed) — not until playout finishes, which would only burn the
        caller's reasoning budget. Callers depend on the accuracy here:
        ``session._deliver_final_response`` skips the chat fallback only when
        ``delivered`` is true, so the old report-on-enqueue behaviour silently
        dropped answers whenever TTS or publishing failed.
        """
        clean = (text or "").strip()[:MAX_SPEAK_CHARS]
        if not clean:
            return {"delivered": False, "reason": "empty_text"}
        if not self.connected or self._room is None:
            if not self.join(room_id):
                return {"delivered": False, "reason": "voice_not_connected"}
        if not self.can_speak:
            return {"delivered": False, "reason": "not_invited_to_voice"}
        item = {"text": clean, "done": threading.Event(), "result": None}
        try:
            self._queue.put_nowait(item)
        except queue.Full:
            return {"delivered": False, "reason": "speak_queue_full"}
        with self._lock:
            should_start = not self._pumping
            if should_start:
                self._pumping = True
        if should_start:
            threading.Thread(target=self._pump, args=(room_id,), daemon=True).start()
        if not item["done"].wait(timeout=SPEAK_RESULT_TIMEOUT_S):
            return {"delivered": False, "reason": "speak_timeout"}
        return item["result"] or {"delivered": False, "reason": "speak_unknown"}

    @staticmethod
    def _settle(item, result: dict) -> None:
        """First writer wins, so the real outcome survives the defensive
        fallbacks in _pump's finally block."""
        if not isinstance(item, dict):
            return
        done = item.get("done")
        if not isinstance(done, threading.Event) or done.is_set():
            return
        item["result"] = result
        done.set()

    def _pump(self, room_id: str) -> None:
        try:
            while True:
                try:
                    item = self._queue.get_nowait()
                except queue.Empty:
                    return
                text = item["text"] if isinstance(item, dict) else item
                try:
                    loop = self._loop
                    if loop is None or loop.is_closed():
                        loop = self._ensure_loop()
                    fut = asyncio.run_coroutine_threadsafe(
                        self._publish_async(text, room_id, item), loop)
                    fut.result(timeout=PUBLISH_TIMEOUT_S)
                except Exception as exc:  # noqa: BLE001
                    msg = str(exc)
                    # LiveKit rejected publish because the token has canPublish=false
                    # (joined before the invite). The invite handler already flips
                    # can_speak, but the LiveKit grant is still stale. One
                    # background re-join with the new token fixes it.
                    if "track publication" in msg.lower() and self.can_speak:
                        logger.warning("publish rejected (stale token) — re-joining room=%s", room_id)
                        try:
                            self._reset_room()
                            if self.join(room_id):
                                logger.info("voice re-joined after publish rejection room=%s", room_id)
                                # Don't auto-retry the same utterance; the caller
                                # (session) will fall back to chat for this turn,
                                # and the next voice turn will publish correctly.
                        except Exception as re_exc:  # noqa: BLE001
                            logger.warning("re-join after publish failure failed room=%s: %s", room_id, re_exc)
                    logger.warning("speak failed room=%s: %s", room_id, exc)
                    self._settle(item, {"delivered": False, "reason": "publish_failed",
                                        "error": str(exc)[:200]})
                finally:
                    # Defensive: a publish path that neither raised nor settled
                    # must not leave speak() blocked until its timeout.
                    self._settle(item, {"delivered": False, "reason": "publish_incomplete"})
        finally:
            with self._lock:
                self._pumping = False
            # Race window: speak() may have queued work after our final
            # get_nowait but before we cleared _pumping (it saw _pumping=True
            # and skipped spawning). Re-arm if so.
            if not self._queue.empty():
                with self._lock:
                    if not self._pumping:
                        self._pumping = True
                        should_restart = True
                    else:
                        should_restart = False
                if should_restart:
                    threading.Thread(target=self._pump, args=(room_id,), daemon=True).start()

    async def _ensure_published(self) -> None:
        if self._audio_source is not None and self._room is not None:
            return
        if self._room is None:
            raise RuntimeError("no LiveKit room")
        from livekit import rtc  # type: ignore
        # AudioSource for synthetic capture; loop is current running loop.
        # queue_size_ms is the jitter cushion: capture_frame blocks once this
        # much audio is queued, which both paces publishing in real time and
        # covers the gap while the next sentence is still synthesizing.
        loop = asyncio.get_running_loop()
        source = rtc.AudioSource(SAMPLE_RATE, CHANNELS,
                                 queue_size_ms=AUDIO_QUEUE_MS, loop=loop)
        track = rtc.LocalAudioTrack.create_audio_track("agent-voice", source)
        pub = await self._room.local_participant.publish_track(
            track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        self._audio_source = source
        self._audio_track = track
        logger.info("voice audio track published sid=%s", getattr(pub, "sid", "unknown"))

    async def _publish_async(self, text: str, room_id: str, item=None) -> None:  # noqa: ANN001
        await self._ensure_published()
        # Echo suppression must never outlive this call: a flat 60s window that
        # only got reset on the success path left the agent deaf for a full
        # minute after any TTS/publish failure. Extended as audio is queued and
        # always released in `finally`.
        self._suppress_until = time.time() + SYNTH_GRACE_S
        from livekit import rtc  # type: ignore
        from voice.tts import synthesize_48k

        # ~200ms of lead-in silence so the first syllable never clips.
        pad = b"\x00\x00" * SAMPLES_PER_FRAME * 20
        buffer = bytearray(pad)
        published = 0
        started_at = 0.0
        try:
            assert self._audio_source is not None

            async def _flush(final: bool = False) -> None:
                """Queue every whole 10ms frame the buffer holds.

                No manual pacing here: ``AudioSource.capture_frame`` blocks once
                its internal queue (AUDIO_QUEUE_MS) is full, so LiveKit does the
                real-time pacing and we stay up to a second ahead. The previous
                ``sleep(0.01)`` per frame double-paced to exactly 1x realtime,
                leaving no cushion — any gap while the next sentence synthesized
                could underrun and stutter.
                """
                nonlocal published, started_at
                while len(buffer) >= BYTES_PER_FRAME:
                    if not self.can_speak:
                        raise RuntimeError("uninvited mid-utterance, cutting speak")
                    if not self.connected or self._room is None:
                        raise RuntimeError("voice disconnected mid-utterance")
                    chunk = bytes(buffer[:BYTES_PER_FRAME])
                    del buffer[:BYTES_PER_FRAME]
                    await self._audio_source.capture_frame(rtc.AudioFrame(
                        data=chunk, sample_rate=SAMPLE_RATE, num_channels=CHANNELS,
                        samples_per_channel=SAMPLES_PER_FRAME,
                    ))
                    published += 1
                    if published == 1:
                        started_at = time.time()
                        # Audio is reaching the room. Resolve speak() here
                        # rather than after playout: the caller only needs to
                        # know whether to fall back to chat, and blocking for
                        # the whole utterance would eat the reasoning budget.
                        self._settle(item, {"delivered": True})
                    # Audio queued so far finishes playing at started_at +
                    # duration; keep the echo guard just past that.
                    self._suppress_until = max(
                        self._suppress_until,
                        started_at + published * (SAMPLES_PER_FRAME / SAMPLE_RATE) + 1.0)
                if final and buffer:
                    # Zero-pad the ragged tail to a whole frame.
                    buffer.extend(b"\x00" * (BYTES_PER_FRAME - len(buffer)))
                    await _flush()

            # Backends stream: piper yields one block per sentence, so the room
            # hears the opening words while the rest is still synthesizing.
            async for pcm in synthesize_48k(text):
                buffer.extend(pcm)
                await _flush()
            buffer.extend(pad)  # ~200ms lead-out
            await _flush(final=True)
            if published == 0:
                raise RuntimeError("no audio frames to publish")
            # Don't report the utterance finished until it has actually played,
            # so queued utterances don't overlap and the echo guard is honest.
            try:
                await self._audio_source.wait_for_playout()
            except Exception:  # noqa: BLE001
                pass
            logger.debug("utterance published room=%s frames=%s (%.1fs)",
                         room_id, published, published * SAMPLES_PER_FRAME / SAMPLE_RATE)
        finally:
            # Release the echo guard ~1s after whatever actually happened.
            self._suppress_until = min(self._suppress_until, time.time() + 1.0)

    # -- listening (remote audio -> VAD -> STT) --

    async def _consume_remote_audio(self, track, participant, room_id: str, rtc) -> None:  # noqa: ANN001
        # Filter to audio only and skip self/unknown
        try:
            if getattr(track, "kind", None) != rtc.TrackKind.KIND_AUDIO:
                return
        except Exception:
            return
        identity = ""
        name = ""
        try:
            identity = getattr(participant, "identity", "") or ""
            name = getattr(participant, "name", "") or identity
        except Exception:
            identity = str(getattr(participant, "identity", "") or "")
            name = identity
        if not identity or "chalkboard-master" in identity or identity.startswith("agent:"):
            return
        generation = self._generation
        logger.debug("voice subscribed room=%s", room_id)

        # Use 16kHz mono resampling - AudioStream does resampling internally
        try:
            stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1, loop=asyncio.get_running_loop())
        except Exception as exc:  # noqa: BLE001
            logger.warning("failed to create AudioStream room=%s identity=%s: %s", room_id, identity, exc)
            return

        from voice.segmenter import UtteranceSegmenter

        segmenter = UtteranceSegmenter(sample_rate=16000)
        try:
            async for ev in stream:
                if generation != self._generation or not self.connected:
                    break
                if ev is None:
                    break
                # ev is AudioFrameEvent
                try:
                    frame = ev.frame if hasattr(ev, "frame") else ev
                except Exception:
                    continue
                if frame is None or not hasattr(frame, "data"):
                    continue
                # drop echo while agent is speaking
                if time.time() < self._suppress_until:
                    try:
                        segmenter.reset()
                    except Exception:
                        pass
                    continue
                # convert frame to int16 numpy array. frame.data is a
                # memoryview over s16le samples — bytes() first so both real
                # frames and test fakes convert identically.
                try:
                    import numpy as _np  # type: ignore

                    try:
                        raw = bytes(frame.data)
                    except Exception:
                        raw = bytes(memoryview(frame.data).cast("B"))
                    if len(raw) % 2:
                        raw = raw[:-1]
                    arr = _np.frombuffer(raw, dtype=_np.int16).copy()
                    if arr.size == 0:
                        continue
                except Exception:
                    continue

                utterance = None
                try:
                    utterance = segmenter.push(arr)
                except Exception:
                    continue
                if utterance is None:
                    continue
                if self._transcribing:
                    logger.debug("dropping utterance while another transcribes room=%s", room_id)
                    continue
                self._transcribing = True
                try:
                    pcm = utterance.get("pcm") if isinstance(utterance, dict) else getattr(utterance, "pcm", None)
                    if pcm is None:
                        continue
                    # run blocking STT off the event loop
                    from voice.transcriber import transcribe_utterance_blocking

                    loop = asyncio.get_running_loop()
                    text = await loop.run_in_executor(
                        None, lambda _pcm=pcm: transcribe_utterance_blocking(_pcm, 16000)
                    )
                    if text:
                        # Log what was heard (truncated) — user asked to see it for debugging.
                        # Keep it short to avoid spamming logs with long utterances.
                        preview = text.strip().replace("\n", " ")[:200]
                        addressed = False
                        try:
                            from voice.transcriber import is_agent_addressed
                            addressed = is_agent_addressed(text)
                        except Exception:
                            pass
                        logger.info("voice transcript room=%s identity=%s addressed=%s text=%r",
                                    room_id, identity, addressed, preview)
                        try:
                            if self.on_transcript:
                                self.on_transcript({
                                    "text": text,
                                    "participantIdentity": identity,
                                    "participantName": name,
                                })
                        except Exception:
                            pass
                    else:
                        logger.info("voice transcript room=%s identity=%s text=<no_speech>", room_id, identity)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("transcription failed room=%s", room_id)
                finally:
                    self._transcribing = False
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.debug("listen loop ended room=%s", room_id)
        finally:
            try:
                if hasattr(stream, "aclose"):
                    await stream.aclose()
                elif hasattr(stream, "close"):
                    stream.close()
            except Exception:
                pass
