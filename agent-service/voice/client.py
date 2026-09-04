"""LiveKit voice presence - full duplex (mirrors src/voice/voiceClient.ts).

Joins the room's LiveKit call as a listener, transcribes remote speech via
VAD segmentation + STT backends, and publishes Edge-TTS audio when the owner
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
"""

from __future__ import annotations

import asyncio
import queue
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


def _decode_to_pcm48k(mp3: bytes) -> bytes:
    candidates = ["ffmpeg"]
    last_error: Exception | None = None
    for binary in candidates:
        try:
            proc = subprocess.run(
                [binary, "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
                 "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"],
                input=mp3, capture_output=True, timeout=60)
            if proc.returncode == 0:
                return proc.stdout
            last_error = RuntimeError(proc.stderr.decode()[:300])
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise last_error or RuntimeError("ffmpeg unavailable")


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

    def join(self, room_id: str) -> bool:
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
                logger.info("voice joined LiveKit as listener room=%s", room_id)
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
        self.can_speak = False
        self._transcribing = False
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break
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

    def set_invited(self, invited: bool, room_id: str) -> None:
        self.can_speak = invited
        logger.info("voice invite state changed room=%s canSpeak=%s", room_id, invited)

    # -- speaking (TTS -> publish) --

    def speak(self, text: str, room_id: str) -> dict:
        clean = (text or "").strip()[:MAX_SPEAK_CHARS]
        if not clean:
            return {"delivered": False, "reason": "empty_text"}
        if not self.connected or self._room is None:
            if not self.join(room_id):
                return {"delivered": False, "reason": "voice_not_connected"}
        if not self.can_speak:
            return {"delivered": False, "reason": "not_invited_to_voice"}
        try:
            self._queue.put_nowait(clean)
        except queue.Full:
            return {"delivered": False, "reason": "speak_queue_full"}
        with self._lock:
            should_start = not self._pumping
            if should_start:
                self._pumping = True
        if should_start:
            threading.Thread(target=self._pump, args=(room_id,), daemon=True).start()
        return {"delivered": True}

    def _pump(self, room_id: str) -> None:
        try:
            while True:
                try:
                    text = self._queue.get_nowait()
                except queue.Empty:
                    return
                try:
                    loop = self._loop
                    if loop is None or loop.is_closed():
                        loop = self._ensure_loop()
                    fut = asyncio.run_coroutine_threadsafe(self._publish_async(text, room_id), loop)
                    fut.result(timeout=60)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("speak failed room=%s: %s", room_id, exc)
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
        # AudioSource for synthetic capture; loop is current running loop
        loop = asyncio.get_running_loop()
        source = rtc.AudioSource(SAMPLE_RATE, CHANNELS, loop=loop)
        track = rtc.LocalAudioTrack.create_audio_track("agent-voice", source)
        pub = await self._room.local_participant.publish_track(
            track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        self._audio_source = source
        self._audio_track = track
        logger.info("voice audio track published sid=%s", getattr(pub, "sid", "unknown"))

    async def _publish_async(self, text: str, room_id: str) -> None:
        await self._ensure_published()
        # suppress echo while we speak + 1s after
        self._suppress_until = time.time() + 60
        try:
            import edge_tts  # type: ignore
        except ImportError as exc:
            raise RuntimeError("edge-tts is not installed") from exc

        async def _synthesize() -> bytes:
            communicate = edge_tts.Communicate(text, config.TTS_VOICE)
            chunks: list[bytes] = []
            async for part in communicate.stream():
                if part.get("type") == "audio" and part.get("data"):
                    chunks.append(part["data"])
            return b"".join(chunks)

        mp3 = await _synthesize()
        if not mp3:
            raise RuntimeError("TTS returned no audio")
        # ffmpeg is a blocking subprocess — keep it off the voice loop so RX
        # streams and concurrent publishes never stall behind a synthesis.
        pcm = await asyncio.get_running_loop().run_in_executor(None, _decode_to_pcm48k, mp3)
        # pad ~200ms silence on both ends so nothing clips
        silence = b"\x00\x00" * SAMPLES_PER_FRAME * 20
        padded = silence + pcm + silence
        # ensure byte alignment
        remainder = len(padded) % BYTES_PER_FRAME
        if remainder:
            padded += b"\x00\x00" * ((BYTES_PER_FRAME - remainder) // 2)
        frames = len(padded) // BYTES_PER_FRAME
        if frames == 0:
            raise RuntimeError("no audio frames to publish")
        from livekit import rtc  # type: ignore
        assert self._audio_source is not None
        for i in range(frames):
            if not self.can_speak:
                raise RuntimeError("uninvited mid-utterance, cutting speak")
            if not self.connected or self._room is None:
                raise RuntimeError("voice disconnected mid-utterance")
            slice_bytes = padded[i * BYTES_PER_FRAME:(i + 1) * BYTES_PER_FRAME]
            frame = rtc.AudioFrame(
                data=slice_bytes,
                sample_rate=SAMPLE_RATE,
                num_channels=CHANNELS,
                samples_per_channel=SAMPLES_PER_FRAME,
            )
            await self._audio_source.capture_frame(frame)
            await asyncio.sleep(0.01)  # pace in real time (10ms)
        logger.info("utterance published room=%s chars=%d pcmBytes=%d frames=%d", room_id, len(text), len(padded), frames)
        self._suppress_until = time.time() + 1.0

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
        logger.info("voice subscribed to speaker room=%s identity=%s", room_id, identity)

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
                        logger.info("voice transcript room=%s identity=%s chars=%d text=%s", room_id, identity, len(text), text[:120])
                        try:
                            if self.on_transcript:
                                self.on_transcript({
                                    "text": text,
                                    "participantIdentity": identity,
                                    "participantName": name,
                                })
                        except Exception:
                            pass
                except Exception as exc:  # noqa: BLE001
                    logger.warning("transcription failed, skipping utterance room=%s: %s", room_id, exc)
                finally:
                    self._transcribing = False
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("listen loop ended room=%s identity=%s: %s", room_id, identity, exc)
        finally:
            try:
                if hasattr(stream, "aclose"):
                    await stream.aclose()
                elif hasattr(stream, "close"):
                    stream.close()
            except Exception:
                pass
