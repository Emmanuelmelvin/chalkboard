"""Voice full-duplex regression tests (offline, all I/O mocked).

Covers the four scaffolding complaints:
  1. join() must call room.connect() and only set connected on success.
  2. speak()/publish must publish PCM frames via AudioSource.capture_frame.
  3. remote audio must flow AudioStream -> VAD -> transcribe -> on_transcript.
  4. livekit must be a real dependency (requirements.txt).
"""

import asyncio
import sys
import time
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from voice import client as voice_client
from voice import tts as tts_mod
from voice.client import AgentVoiceClient


# ---- fakes ----

class FakeTrackKind:
    KIND_AUDIO = 1
    KIND_VIDEO = 2


class FakeTrackSource:
    SOURCE_MICROPHONE = 2


class FakeTrackPublishOptions:
    def __init__(self, *a, **k):
        self.source = None


class FakeAudioFrame:
    def __init__(self, data, sample_rate, num_channels, samples_per_channel):
        self.data = data
        self.sample_rate = sample_rate
        self.num_channels = num_channels
        self.samples_per_channel = samples_per_channel


class FakeAudioSource:
    instances: list = []

    def __init__(self, sample_rate, num_channels, queue_size_ms=1000, loop=None):
        self.sample_rate = sample_rate
        self.num_channels = num_channels
        self.queue_size_ms = queue_size_ms
        self.frames: list[bytes] = []
        FakeAudioSource.instances.append(self)

    async def capture_frame(self, frame):
        self.frames.append(bytes(frame.data))

    async def wait_for_playout(self):
        return None


class FakeLocalTrack:
    @staticmethod
    def create_audio_track(name, source):
        t = types.SimpleNamespace(name=name, source=source, kind=1, sid="track-1")
        return t


class FakeLocalParticipant:
    def __init__(self):
        self.published: list = []
        self.identity = "agent:chalkboard-master"

    async def publish_track(self, track, options):
        self.published.append((track, options))
        return types.SimpleNamespace(sid="pub-1")


class FakeRoom:
    instances: list = []

    def __init__(self, loop=None):
        self.loop = loop
        self.handlers: dict[str, list] = {}
        self.connect_called: list[tuple] = []
        self.disconnect_called = 0
        self.should_fail_connect = False
        self.remote_participants: dict = {}
        self.local_participant = FakeLocalParticipant()
        FakeRoom.instances.append(self)

    def on(self, event, handler=None):
        # Supports both @room.on("x") decorator and room.on("x", fn) forms.
        if handler is None:
            def _deco(fn):
                self.handlers.setdefault(event, []).append(fn)
                return fn
            return _deco
        self.handlers.setdefault(event, []).append(handler)
        return handler

    async def connect(self, url, token):
        self.connect_called.append((url, token))
        if self.should_fail_connect or token == "fail":
            raise RuntimeError("connect refused")
        return None

    async def disconnect(self):
        self.disconnect_called += 1
        return None


def make_fake_rtc(room_cls=FakeRoom, stream_frames=None):
    rtc = types.SimpleNamespace()
    rtc.Room = room_cls
    rtc.TrackKind = FakeTrackKind
    rtc.TrackSource = FakeTrackSource
    rtc.TrackPublishOptions = FakeTrackPublishOptions
    rtc.AudioSource = FakeAudioSource
    rtc.LocalAudioTrack = FakeLocalTrack
    rtc.AudioFrame = FakeAudioFrame

    frames = list(stream_frames or [])

    class FakeAudioStream:
        created: list = []

        def __init__(self, track, sample_rate=16000, num_channels=1, loop=None):
            self.track = track
            self.sample_rate = sample_rate
            self.num_channels = num_channels
            self.aclose_called = False
            FakeAudioStream.created.append(self)

        def __aiter__(self):
            async def _gen():
                for data in frames:
                    ev = types.SimpleNamespace(
                        frame=types.SimpleNamespace(data=memoryview(data)))
                    yield ev
            return _gen()

        async def aclose(self):
            self.aclose_called = True

    rtc.AudioStream = FakeAudioStream
    return rtc


def install_fake_rtc(monkeypatch, rtc):
    mod = types.ModuleType("livekit")
    mod.rtc = rtc
    monkeypatch.setitem(sys.modules, "livekit", mod)
    monkeypatch.setitem(sys.modules, "livekit.rtc", rtc)
    return mod


def fake_backend_ok(room_url="wss://livekit.test", token="tok-123", invited=None):
    def _post(path, payload, timeout_s=10):
        assert path == "/api/internal/agent/voice-token"
        body = {"url": room_url, "token": token}
        if invited is not None:
            body["invited"] = invited
        return 200, body
    return _post


def install_fake_tts(monkeypatch, mp3=b"mp3-bytes", fail_times=0, pcm=None):
    """Patch edge_tts + the decoder and force the edge backend.

    Returns the attempt counter list.
    """
    force_backends(monkeypatch, ["edge"])
    return install_fake_edge(monkeypatch, mp3=mp3, fail_times=fail_times, pcm=pcm)


def force_backends(monkeypatch, order):
    """Pin the TTS backend chain so a test never depends on the real piper model."""
    monkeypatch.setattr(tts_mod, "backend_order", lambda: list(order))


def install_fake_edge(monkeypatch, mp3=b"mp3-bytes", fail_times=0, pcm=None):
    attempts: list[int] = []

    class FakeCommunicate:
        def __init__(self, *a, **k):
            pass

        async def stream(self):
            attempts.append(1)
            if len(attempts) <= fail_times:
                raise RuntimeError("edge-tts unreachable")
            yield {"type": "audio", "data": mp3}

    edge_mod = types.ModuleType("edge_tts")
    edge_mod.Communicate = FakeCommunicate
    monkeypatch.setitem(sys.modules, "edge_tts", edge_mod)
    if pcm is None:
        pcm = (np.zeros(4800, dtype=np.int16) + 100).tobytes()
    monkeypatch.setattr(voice_client, "_decode_to_pcm48k", lambda _mp3: pcm)
    monkeypatch.setattr(voice_client, "decode_mp3_to_pcm48k", lambda _mp3: pcm)
    # Keep retry backoff out of the test runtime.
    monkeypatch.setattr(tts_mod, "EDGE_RETRY_BASE_DELAY_S", 0.0)
    return attempts


def install_fake_piper(monkeypatch, chunk_samples=(2205, 2205), rate=22050, fail=None):
    """Fake PiperVoice yielding sentence-sized chunks at its native rate."""
    calls: list[str] = []

    class FakeChunk:
        def __init__(self, n):
            self.sample_rate = rate
            self.sample_width = 2
            self.sample_channels = 1
            self.audio_int16_bytes = (np.zeros(n, dtype=np.int16) + 1200).tobytes()

    class FakeVoice:
        def synthesize(self, text, *a, **k):
            calls.append(text)
            for n in chunk_samples:
                yield FakeChunk(n)

    def _get():
        if fail:
            raise RuntimeError(fail)
        return FakeVoice()

    monkeypatch.setattr(tts_mod, "get_piper_voice", _get)
    return calls


def wait_for_publish(client, timeout=15.0):
    """Block until the speak pump has drained.

    speak() deliberately resolves on the FIRST published frame, so a test that
    inspects the published frame list right after it returns races the tail of
    the utterance.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not client._pumping and client._queue.empty():
            return True
        time.sleep(0.02)
    raise AssertionError("publish did not finish in time")



# ---- tests ----

def test_requirements_declares_livekit():
    req = (Path(__file__).resolve().parents[1] / "requirements.txt").read_text()
    assert "livekit==" in req or "livekit>=" in req
    assert "livekit-rtc" not in req  # old wrong package name is gone


def test_join_calls_connect_and_sets_connected(monkeypatch):
    FakeRoom.instances.clear()
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())
    import http_client  # noqa: F401  (ensures patch target exists)

    c = AgentVoiceClient()
    assert c.connected is False
    assert c.join("room-a") is True
    assert c.connected is True
    assert c._room is not None
    # THE regression: scaffold never called connect().
    assert c._room.connect_called == [("wss://livekit.test", "tok-123")]
    assert c._room_id == "room-a"
    c.leave()


def test_join_does_not_set_connected_when_connect_fails(monkeypatch):
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok(token="fail"))

    c = AgentVoiceClient()
    assert c.join("room-a") is False
    assert c.connected is False
    assert c._room is None
    c.leave()


def test_join_degrades_when_livekit_missing(monkeypatch):
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())
    monkeypatch.delitem(sys.modules, "livekit", raising=False)
    monkeypatch.delitem(sys.modules, "livekit.rtc", raising=False)
    # Block the real installed livekit from importing.
    import builtins
    real_import = builtins.__import__

    def _guard(name, *a, **k):
        if name == "livekit" or name.startswith("livekit."):
            raise ImportError("blocked for test")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", _guard)

    c = AgentVoiceClient()
    assert c.join("room-a") is False
    assert c.connected is False


def test_speak_gating(monkeypatch):
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.speak("", "r")["reason"] == "empty_text"
    # Not connected and token fetch fails -> voice_not_connected.
    monkeypatch.setattr("http_client.backend_post", lambda *a, **k: (403, {}))
    assert c.speak("hello", "r") == {"delivered": False, "reason": "voice_not_connected"}
    # Connected but not invited -> must use chat instead.
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())
    assert c.join("r") is True
    assert c.speak("hello", "r") == {"delivered": False, "reason": "not_invited_to_voice"}


def test_speak_queue_full(monkeypatch):
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    # Fill the queue without pumping.
    for _ in range(3):
        c._queue.put_nowait("x")
    assert c.speak("one more", "r") == {"delivered": False, "reason": "speak_queue_full"}
    c.leave()


def test_publish_streams_pcm_frames(monkeypatch):
    """_publish_async must push 10ms PCM frames to AudioSource (was log-only)."""
    FakeAudioSource.instances.clear()
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")

    # Fake Edge TTS -> tiny mp3; fake decode -> 0.1s of 48k PCM.
    install_fake_tts(monkeypatch)

    asyncio.run(c._publish_async("hello there", "r"))

    assert len(FakeAudioSource.instances) == 1
    src = FakeAudioSource.instances[0]
    # 4800 samples + 2x9600 silence pads, all in 960-byte frames.
    assert len(src.frames) > 0
    assert all(len(f) == 960 for f in src.frames)
    # Payload is not silence: TTS PCM was captured between the pads.
    assert any(set(f) != {0} for f in src.frames)
    # Room got a published microphone track.
    assert len(c._room.local_participant.published) == 1
    c.leave()


# ---- decoder: PyAV first, ffmpeg fallback, no system ffmpeg needed ----

def _make_mp3(seconds: float = 0.5, rate: int = 24000) -> bytes:
    """Encode a real mp3 in-process so the decode test needs no network."""
    import io as _io

    import av  # type: ignore

    t = np.arange(int(rate * seconds)) / rate
    tone = (np.sin(2 * np.pi * 440 * t) * 8000).astype(np.int16)
    buf = _io.BytesIO()
    container = av.open(buf, mode="w", format="mp3")
    stream = container.add_stream("libmp3lame", rate=rate)
    frame = av.AudioFrame.from_ndarray(tone.reshape(1, -1), format="s16", layout="mono")
    frame.sample_rate = rate
    frame.pts = 0
    for packet in stream.encode(frame):
        container.mux(packet)
    for packet in stream.encode(None):
        container.mux(packet)
    container.close()
    return buf.getvalue()


def test_decode_uses_pyav_without_system_ffmpeg(monkeypatch):
    """The TTS decode path must not depend on an ffmpeg binary on PATH."""
    mp3 = _make_mp3(seconds=0.5)

    def _no_ffmpeg(_mp3):
        raise FileNotFoundError("[WinError 2] The system cannot find the file specified")

    monkeypatch.setattr(voice_client, "_decode_ffmpeg", _no_ffmpeg)
    pcm = voice_client._decode_to_pcm48k(mp3)
    # 0.5s of 48kHz mono s16 ~= 48000 bytes; mp3 padding makes it approximate.
    assert len(pcm) > 40_000
    assert len(pcm) % 2 == 0
    assert set(pcm) != {0}


def test_decode_falls_back_to_ffmpeg_when_pyav_fails(monkeypatch):
    monkeypatch.setattr(voice_client, "_decode_pyav",
                        lambda _mp3: (_ for _ in ()).throw(RuntimeError("pyav boom")))
    monkeypatch.setattr(voice_client, "_decode_ffmpeg", lambda _mp3: b"\x01\x02")
    assert voice_client._decode_to_pcm48k(b"x") == b"\x01\x02"


def test_decode_raises_with_both_errors(monkeypatch):
    monkeypatch.setattr(voice_client, "_decode_pyav",
                        lambda _mp3: (_ for _ in ()).throw(RuntimeError("pyav boom")))
    monkeypatch.setattr(voice_client, "_decode_ffmpeg",
                        lambda _mp3: (_ for _ in ()).throw(RuntimeError("no ffmpeg")))
    try:
        voice_client._decode_to_pcm48k(b"x")
        raise AssertionError("expected decode failure")
    except RuntimeError as exc:
        assert "pyav boom" in str(exc) and "no ffmpeg" in str(exc)


# ---- suppression window must never outlive the utterance ----

def test_suppress_window_released_when_tts_fails(monkeypatch):
    """A failed speak must not leave the agent deaf (was a flat 60s window)."""
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    # Every TTS attempt fails, on both backends.
    monkeypatch.setattr(tts_mod, "EDGE_TIMEOUT_S", 0.5)
    install_fake_tts(monkeypatch, fail_times=tts_mod.EDGE_ATTEMPTS)

    try:
        asyncio.run(c._publish_async("hello", "r"))
        raise AssertionError("expected TTS failure")
    except RuntimeError:
        pass
    # THE regression: window must be ~1s, not the 60s worst-case guess.
    assert c._suppress_until - time.time() <= 1.5
    c.leave()


def test_suppress_window_scales_with_audio_length(monkeypatch):
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    install_fake_tts(monkeypatch)
    asyncio.run(c._publish_async("hello", "r"))
    # Success path also collapses to ~1s once publishing has finished.
    assert c._suppress_until - time.time() <= 1.5
    c.leave()


# ---- speak() must report the real outcome ----

def test_speak_reports_publish_failure(monkeypatch):
    """delivered=False on failure, so session.py falls back to chat."""
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    monkeypatch.setattr(tts_mod, "EDGE_TIMEOUT_S", 0.5)
    install_fake_tts(monkeypatch, fail_times=tts_mod.EDGE_ATTEMPTS)

    result = c.speak("hello", "r")
    assert result["delivered"] is False
    assert result["reason"] == "publish_failed"
    c.leave()


def test_speak_reports_success_after_frames_published(monkeypatch):
    FakeAudioSource.instances.clear()
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    install_fake_tts(monkeypatch)

    result = c.speak("hello there", "r")
    assert result["delivered"] is True
    assert len(FakeAudioSource.instances[0].frames) > 0
    c.leave()


def test_tts_retries_then_succeeds(monkeypatch):
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    attempts = install_fake_tts(monkeypatch, fail_times=1)

    assert c.speak("hello", "r")["delivered"] is True
    assert len(attempts) == 2  # first failed, second succeeded
    c.leave()


def test_leave_settles_queued_utterances(monkeypatch):
    """leave() must not leave a speak() caller blocked on its timeout."""
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    item = {"text": "queued", "done": __import__("threading").Event(), "result": None}
    c._queue.put_nowait(item)
    c.leave()
    assert item["done"].is_set()
    assert item["result"]["delivered"] is False


# ---- durable invite state ----

def test_join_seeds_can_speak_from_token(monkeypatch):
    """A restarted agent keeps a standing invite (voice:invited is not replayed)."""
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok(invited=True))

    c = AgentVoiceClient()
    assert c.join("r") is True
    assert c.can_speak is True
    assert c.state == "speaking-enabled"
    c.leave()


def test_join_seed_does_not_override_explicit_invite(monkeypatch):
    """An owner decision during reconnect outranks the stale token seed."""
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok(invited=True))

    c = AgentVoiceClient()
    c.set_invited(False, "r")  # owner removed voice while we were reconnecting
    assert c.join("r") is True
    assert c.can_speak is False
    c.leave()


def test_join_without_invited_field_keeps_listening(monkeypatch):
    """Older backend without the `invited` field must not break the join."""
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    assert c.can_speak is False
    assert c.state == "listening"
    c.leave()


# ---- reconnect supervision ----

def test_supervisor_rejoins_after_disconnect(monkeypatch):
    """A LiveKit drop must not lose voice permanently."""
    FakeRoom.instances.clear()
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok(invited=True))
    monkeypatch.setattr(voice_client, "RECONNECT_BASE_DELAY_S", 0.01)

    c = AgentVoiceClient()
    assert c.join("r") is True
    assert len(FakeRoom.instances) == 1

    # Simulate the server-side disconnect event.
    for handler in FakeRoom.instances[0].handlers.get("disconnected", []):
        handler("network")
    assert c.connected is False

    deadline = time.time() + 5
    while time.time() < deadline and len(FakeRoom.instances) < 2:
        time.sleep(0.05)
    assert len(FakeRoom.instances) >= 2, "supervisor did not rejoin"
    assert c.connected is True
    assert c.can_speak is True  # invite survives the reconnect
    c.leave()


def test_supervisor_refreshes_expiring_token(monkeypatch):
    FakeRoom.instances.clear()
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())
    monkeypatch.setattr(voice_client, "RECONNECT_BASE_DELAY_S", 0.01)
    monkeypatch.setattr(voice_client, "TOKEN_REFRESH_S", 0.0)

    c = AgentVoiceClient()
    assert c.join("r") is True
    deadline = time.time() + 5
    while time.time() < deadline and len(FakeRoom.instances) < 2:
        time.sleep(0.05)
    assert len(FakeRoom.instances) >= 2, "supervisor did not refresh the token"
    c.leave()


def test_leave_stops_supervisor(monkeypatch):
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())
    monkeypatch.setattr(voice_client, "RECONNECT_BASE_DELAY_S", 0.01)

    c = AgentVoiceClient()
    assert c.join("r") is True
    supervisor = c._supervisor
    assert supervisor is not None
    c.leave()
    supervisor.join(timeout=3)
    assert supervisor.is_alive() is False


def test_rx_path_feeds_vad_and_transcriber(monkeypatch):
    """AudioStream frames -> segmenter -> transcribe -> on_transcript."""
    # Loud 16k mono speech then silence long enough to flush the utterance.
    loud = (np.zeros(160, dtype=np.int16) + 4000).tobytes()
    silence = np.zeros(160, dtype=np.int16).tobytes()
    # 60x10ms speech (600ms, meets min_utterance_ms) + 100x10ms silence
    # (1000ms, exceeds silence_end_ms=900ms so the segmenter flushes).
    rtc = make_fake_rtc(stream_frames=[loud] * 60 + [silence] * 100)
    install_fake_rtc(monkeypatch, rtc)

    c = AgentVoiceClient()
    c.connected = True  # bypass network; drive the consumer directly
    got: list[dict] = []
    c.on_transcript = got.append
    monkeypatch.setattr(
        "voice.transcriber.transcribe_utterance_blocking",
        lambda pcm, sr: "hey master draw a circle",
    )

    track = types.SimpleNamespace(kind=FakeTrackKind.KIND_AUDIO)
    participant = types.SimpleNamespace(identity="user-1", name="Ada")

    asyncio.run(c._consume_remote_audio(track, participant, "r", rtc))

    assert len(got) == 1
    assert got[0]["text"] == "hey master draw a circle"
    assert got[0]["participantIdentity"] == "user-1"
    # Stream was closed via the async API.
    assert rtc.AudioStream.created[0].aclose_called is True


def test_rx_ignores_self_and_suppressed(monkeypatch):
    rtc = make_fake_rtc(stream_frames=[])
    install_fake_rtc(monkeypatch, rtc)
    c = AgentVoiceClient()
    c.connected = True
    got: list[dict] = []
    c.on_transcript = got.append

    track = types.SimpleNamespace(kind=FakeTrackKind.KIND_AUDIO)
    # Self tracks never transcribe.
    asyncio.run(c._consume_remote_audio(
        track, types.SimpleNamespace(identity="agent:chalkboard-master", name="Master"),
        "r", rtc))
    assert got == []

    # Suppressed window (agent speaking) drops frames without transcribing.
    import time as _time
    c._suppress_until = _time.time() + 60
    calls: list = []
    monkeypatch.setattr(
        "voice.transcriber.transcribe_utterance_blocking",
        lambda pcm, sr: calls.append(1) or "hello",
    )
    loud = (np.zeros(160, dtype=np.int16) + 4000).tobytes()
    rtc2 = make_fake_rtc(stream_frames=[loud] * 60)
    asyncio.run(c._consume_remote_audio(
        track, types.SimpleNamespace(identity="user-2", name="Bo"),
        "r", rtc2))
    assert calls == [] and got == []


def test_leave_disconnects_and_clears(monkeypatch):
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    room = c._room
    c.leave()
    assert c.connected is False
    assert c._room is None
    assert c._room_id is None
    assert c.can_speak is False
    assert room.disconnect_called == 1


# ---- TTS backends: local piper primary, edge-tts fallback ----

def test_piper_is_the_default_backend():
    """Voice must not depend on a third-party endpoint by default."""
    assert tts_mod.backend_order()[0] == "piper"
    assert tts_mod.backend_order() == ["piper", "edge"]


def test_backend_order_puts_the_other_backend_second(monkeypatch):
    import config as cfg
    monkeypatch.setattr(cfg, "TTS_BACKEND", "edge")
    assert tts_mod.backend_order() == ["edge", "piper"]
    monkeypatch.setattr(cfg, "TTS_BACKEND", "nonsense")
    assert tts_mod.backend_order() == ["piper", "edge"]


def test_resampler_is_sample_exact_across_chunks():
    """22050 -> 48000 must not drift; one resampler per utterance, not per chunk."""
    r = tts_mod.Resampler48k(22050)
    chunk = (np.zeros(22050, dtype=np.int16) + 500).tobytes()  # 1s
    total = sum(len(r.feed(chunk)) for _ in range(3))
    total += len(r.flush())
    assert total // 2 == 3 * 48000


def test_resampler_passthrough_at_target_rate():
    r = tts_mod.Resampler48k(48000)
    pcm = b"\x01\x02" * 100
    assert r.feed(pcm) == pcm
    assert r.flush() == b""


def test_piper_path_publishes_resampled_frames(monkeypatch):
    """Local piper output must reach the room as aligned 48kHz frames."""
    FakeAudioSource.instances.clear()
    rtc = make_fake_rtc()
    install_fake_rtc(monkeypatch, rtc)
    monkeypatch.setattr("http_client.backend_post", fake_backend_ok())
    force_backends(monkeypatch, ["piper"])
    # two sentence-sized chunks of 0.1s each at piper's native 22.05kHz
    install_fake_piper(monkeypatch, chunk_samples=(2205, 2205))

    c = AgentVoiceClient()
    assert c.join("r") is True
    c.set_invited(True, "r")
    assert c.speak("Two sentences here. And the second one.", "r")["delivered"] is True
    wait_for_publish(c)

    src = FakeAudioSource.instances[0]
    assert src.queue_size_ms == voice_client.AUDIO_QUEUE_MS
    assert all(len(f) == 960 for f in src.frames)
    # 0.2s of speech + 2x0.2s padding = ~0.6s = ~60 frames.
    assert 58 <= len(src.frames) <= 62, len(src.frames)
    assert any(set(f) != {0} for f in src.frames)
    c.leave()


def test_piper_streams_chunk_by_chunk(monkeypatch):
    """Frames must be published per chunk, not only after full synthesis."""
    force_backends(monkeypatch, ["piper"])
    install_fake_piper(monkeypatch, chunk_samples=(2205, 2205, 2205))

    seen: list[int] = []

    async def _collect():
        async for pcm in tts_mod.synthesize_48k("a. b. c."):
            seen.append(len(pcm))
        return len(seen)

    # 3 chunks, plus whatever the resampler holds back until flush.
    assert asyncio.run(_collect()) >= 3
    # each 0.1s chunk at 22.05k becomes ~0.1s at 48k (~9600 bytes)
    assert all(9000 <= n <= 10000 for n in seen[:3]), seen
    assert sum(seen) // 2 == 3 * 4800, sum(seen)  # sample-exact overall



def test_falls_back_to_edge_when_piper_unavailable(monkeypatch):
    """A missing/broken local model must not silence the agent."""
    force_backends(monkeypatch, ["piper", "edge"])
    install_fake_piper(monkeypatch, fail="piper voice missing")
    install_fake_edge(monkeypatch)

    async def _collect():
        return [pcm async for pcm in tts_mod.synthesize_48k("hello")]

    blocks = asyncio.run(_collect())
    assert len(blocks) == 1 and len(blocks[0]) == 9600


def test_falls_back_to_piper_when_edge_unavailable(monkeypatch):
    """The point of the local backend: network TTS dying is survivable."""
    force_backends(monkeypatch, ["edge", "piper"])
    monkeypatch.setattr(tts_mod, "EDGE_TIMEOUT_S", 0.2)
    attempts = install_fake_edge(monkeypatch, fail_times=99)
    install_fake_piper(monkeypatch, chunk_samples=(2205,))

    async def _collect():
        return [pcm async for pcm in tts_mod.synthesize_48k("hello")]

    blocks = asyncio.run(_collect())
    assert len(attempts) == tts_mod.EDGE_ATTEMPTS  # exhausted retries first
    assert blocks and sum(len(b) for b in blocks) > 0



def test_raises_when_every_backend_fails(monkeypatch):
    force_backends(monkeypatch, ["piper", "edge"])
    monkeypatch.setattr(tts_mod, "EDGE_TIMEOUT_S", 0.2)
    install_fake_piper(monkeypatch, fail="no model")
    install_fake_edge(monkeypatch, fail_times=99)

    async def _collect():
        return [pcm async for pcm in tts_mod.synthesize_48k("hello")]

    try:
        asyncio.run(_collect())
        raise AssertionError("expected total TTS failure")
    except RuntimeError as exc:
        assert "no model" in str(exc) and "edge" in str(exc)


def test_no_fallback_once_audio_is_already_audible(monkeypatch):
    """Switching voice mid-sentence is worse than failing; must re-raise."""
    force_backends(monkeypatch, ["piper", "edge"])
    install_fake_edge(monkeypatch)

    class HalfBrokenVoice:
        def synthesize(self, text, *a, **k):
            yield types.SimpleNamespace(
                sample_rate=22050,
                audio_int16_bytes=(np.zeros(2205, dtype=np.int16) + 900).tobytes())
            raise RuntimeError("died mid-utterance")

    monkeypatch.setattr(tts_mod, "get_piper_voice", lambda: HalfBrokenVoice())

    async def _collect():
        return [pcm async for pcm in tts_mod.synthesize_48k("hello")]

    try:
        asyncio.run(_collect())
        raise AssertionError("expected the mid-stream error to propagate")
    except RuntimeError as exc:
        assert "died mid-utterance" in str(exc)


def test_piper_model_path_uses_config(monkeypatch):
    import config as cfg
    monkeypatch.setattr(cfg, "PIPER_VOICE_DIR", "/tmp/voices")
    monkeypatch.setattr(cfg, "PIPER_VOICE", "en_US-test-medium")
    assert tts_mod.piper_model_path().name == "en_US-test-medium.onnx"


def test_missing_model_without_autodownload_is_a_clear_error(monkeypatch, tmp_path):
    import config as cfg
    monkeypatch.setattr(cfg, "PIPER_VOICE_DIR", str(tmp_path))
    monkeypatch.setattr(cfg, "PIPER_AUTO_DOWNLOAD", False)
    monkeypatch.setattr(tts_mod, "_piper_voice", None)
    try:
        tts_mod.get_piper_voice()
        raise AssertionError("expected a missing-model error")
    except RuntimeError as exc:
        assert "piper voice missing" in str(exc)
        assert "download_voices" in str(exc)  # actionable
