"""Voice full-duplex regression tests (offline, all I/O mocked).

Covers the four scaffolding complaints:
  1. join() must call room.connect() and only set connected on success.
  2. speak()/publish must publish PCM frames via AudioSource.capture_frame.
  3. remote audio must flow AudioStream -> VAD -> transcribe -> on_transcript.
  4. livekit must be a real dependency (requirements.txt).
"""

import asyncio
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from voice import client as voice_client
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

    def __init__(self, sample_rate, num_channels, loop=None):
        self.sample_rate = sample_rate
        self.num_channels = num_channels
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


def fake_backend_ok(room_url="wss://livekit.test", token="tok-123"):
    def _post(path, payload, timeout_s=10):
        assert path == "/api/internal/agent/voice-token"
        return 200, {"url": room_url, "token": token}
    return _post


# ---- tests ----

def test_requirements_declares_livekit():
    req = (Path(__file__).resolve().parents[1] / "requirements.txt").read_text()
    assert "livekit>=" in req
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
    fake_mp3 = b"mp3-bytes"

    class FakeCommunicate:
        def __init__(self, *a, **k):
            pass

        async def stream(self):
            yield {"type": "audio", "data": fake_mp3}

    edge_mod = types.ModuleType("edge_tts")
    edge_mod.Communicate = FakeCommunicate
    monkeypatch.setitem(sys.modules, "edge_tts", edge_mod)
    pcm = (np.zeros(4800, dtype=np.int16) + 100).tobytes()  # 4800 samples @48k = 100ms
    monkeypatch.setattr(voice_client, "_decode_to_pcm48k", lambda mp3: pcm)

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
