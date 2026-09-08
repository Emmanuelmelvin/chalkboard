"""Text-to-speech backends for the LiveKit publish path.

Every backend exposes the same contract: given text, yield 48 kHz mono s16le
PCM blocks (LiveKit's ``AudioSource`` format) as soon as they are available.

Backends
--------
``piper`` (default)
    Local neural TTS via ONNX Runtime. Fully offline, no API key, no vendor
    endpoint. Synthesizes at ~5.8x realtime on a modest CPU and emits one chunk
    per sentence, so the first audio reaches the room in well under a second
    even for long answers. Native rate is 22.05 kHz; resampled here.

``edge``
    Microsoft Edge read-aloud (``edge-tts``). Higher fidelity, but an
    undocumented third-party endpoint with no SLA that does time out in
    practice — kept as a fallback rather than the default.

Whichever backend is configured, the other is tried if the first produces no
audio at all. Fallback is deliberately *not* attempted once audio has already
been yielded: the room has heard part of the utterance, and restarting with a
different voice mid-sentence is worse than failing.
"""

from __future__ import annotations

import asyncio
import threading
from fractions import Fraction
from pathlib import Path
from typing import AsyncIterator

import config
from logger import logger

TARGET_RATE = 48000
# edge-tts is a network call; piper is local, so a failure there is a real
# error (missing model, bad voice name) that retrying cannot fix.
EDGE_ATTEMPTS = 3
EDGE_TIMEOUT_S = 12.0
EDGE_RETRY_BASE_DELAY_S = 0.5
PIPER_TIMEOUT_S = 120.0


class Resampler48k:
    """Stateful resampler to 48 kHz mono s16le.

    One instance per utterance: PyAV carries fractional-ratio state between
    calls, which is what keeps 22050 -> 48000 sample-exact across the
    sentence-sized chunks piper emits (a per-chunk resampler drifts).
    """

    def __init__(self, source_rate: int):
        self.source_rate = source_rate
        self._passthrough = source_rate == TARGET_RATE
        self._resampler = None
        if not self._passthrough:
            import av  # type: ignore
            self._resampler = av.AudioResampler(format="s16", layout="mono", rate=TARGET_RATE)

    def feed(self, pcm: bytes) -> bytes:
        if self._passthrough or not pcm:
            return pcm
        import av  # type: ignore
        import numpy as np

        arr = np.frombuffer(pcm, dtype=np.int16).reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(arr, format="s16", layout="mono")
        frame.sample_rate = self.source_rate
        frame.time_base = Fraction(1, self.source_rate)
        return b"".join(r.to_ndarray().tobytes() for r in self._resampler.resample(frame))

    def flush(self) -> bytes:
        if self._passthrough or self._resampler is None:
            return b""
        try:
            return b"".join(r.to_ndarray().tobytes() for r in (self._resampler.resample(None) or []))
        except Exception:  # noqa: BLE001
            return b""


# ---- piper (local, default) ----

_piper_voice = None
_piper_lock = threading.Lock()


def piper_model_path() -> Path:
    return Path(config.PIPER_VOICE_DIR) / f"{config.PIPER_VOICE}.onnx"


def _download_piper_voice(model: Path) -> None:
    """Fetch the voice once so local dev is zero-setup.

    Production images bake the model in at build time (see Dockerfile), so this
    never runs there — the point of a local backend is not to depend on a
    network fetch at request time.
    """
    from piper.download_voices import download_voice  # type: ignore

    target = model.parent
    target.mkdir(parents=True, exist_ok=True)
    logger.info("downloading piper voice %s to %s (one-time, ~60MB)",
                config.PIPER_VOICE, target)
    download_voice(config.PIPER_VOICE, target)


def get_piper_voice():
    """Load and cache the piper voice. Blocking; ~9s on a cold ONNX session."""
    global _piper_voice
    if _piper_voice is not None:
        return _piper_voice
    with _piper_lock:
        if _piper_voice is not None:
            return _piper_voice
        from piper import PiperVoice  # type: ignore

        model = piper_model_path()
        if not model.exists():
            if not config.PIPER_AUTO_DOWNLOAD:
                raise RuntimeError(
                    f"piper voice missing: {model}. Download it with "
                    f"`python -m piper.download_voices {config.PIPER_VOICE} "
                    f"--download-dir {config.PIPER_VOICE_DIR}` or set "
                    f"PIPER_AUTO_DOWNLOAD=true.")
            _download_piper_voice(model)
        logger.info("loading piper voice %s", model.name)
        _piper_voice = PiperVoice.load(model)
        return _piper_voice


async def _synthesize_piper(text: str) -> AsyncIterator[bytes]:
    loop = asyncio.get_running_loop()
    voice = await loop.run_in_executor(None, get_piper_voice)
    # Blocking generator -> async iterator, one chunk at a time, so ONNX
    # inference never runs on the voice event loop (it would stall RX streams
    # and the paced publish).
    chunks = voice.synthesize(text)
    resampler: Resampler48k | None = None

    def _next():
        try:
            return next(chunks)
        except StopIteration:
            return None

    while True:
        chunk = await asyncio.wait_for(loop.run_in_executor(None, _next), timeout=PIPER_TIMEOUT_S)
        if chunk is None:
            break
        if resampler is None:
            resampler = Resampler48k(chunk.sample_rate)
        pcm = resampler.feed(chunk.audio_int16_bytes)
        if pcm:
            yield pcm
    if resampler is not None:
        tail = resampler.flush()
        if tail:
            yield tail


# ---- edge-tts (network fallback) ----

async def _edge_mp3(text: str) -> bytes:
    import edge_tts  # type: ignore

    communicate = edge_tts.Communicate(text, config.TTS_VOICE)
    parts: list[bytes] = []
    async for part in communicate.stream():
        if part.get("type") == "audio" and part.get("data"):
            parts.append(part["data"])
    return b"".join(parts)


async def _synthesize_edge(text: str) -> AsyncIterator[bytes]:
    last_error: Exception | None = None
    mp3 = b""
    for attempt in range(1, EDGE_ATTEMPTS + 1):
        try:
            mp3 = await asyncio.wait_for(_edge_mp3(text), timeout=EDGE_TIMEOUT_S)
            if mp3:
                break
            last_error = RuntimeError("edge-tts returned no audio")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        if attempt < EDGE_ATTEMPTS:
            delay = EDGE_RETRY_BASE_DELAY_S * (2 ** (attempt - 1))
            logger.warning("edge-tts attempt %s/%s failed (%s) — retrying in %.1fs",
                           attempt, EDGE_ATTEMPTS, str(last_error)[:160], delay)
            await asyncio.sleep(delay)
    if not mp3:
        raise RuntimeError(f"edge-tts failed after {EDGE_ATTEMPTS} attempts: "
                           f"{str(last_error)[:200]}")
    # mp3 frame boundaries make incremental decode fiddly; decode the whole
    # utterance off-loop and hand it over in one block.
    from voice.client import decode_mp3_to_pcm48k

    loop = asyncio.get_running_loop()
    pcm = await loop.run_in_executor(None, decode_mp3_to_pcm48k, mp3)
    if not pcm:
        raise RuntimeError("edge-tts audio decoded to nothing")
    yield pcm


_BACKENDS = {"piper": _synthesize_piper, "edge": _synthesize_edge}


def backend_order() -> list[str]:
    primary = config.TTS_BACKEND if config.TTS_BACKEND in _BACKENDS else "piper"
    return [primary] + [name for name in ("piper", "edge") if name != primary]


async def synthesize_48k(text: str) -> AsyncIterator[bytes]:
    """Yield 48 kHz mono s16le blocks for ``text``, trying backends in order."""
    errors: list[str] = []
    for name in backend_order():
        produced = False
        try:
            async for pcm in _BACKENDS[name](text):
                produced = True
                yield pcm
            if produced:
                return
            errors.append(f"{name}: produced no audio")
        except Exception as exc:  # noqa: BLE001
            if produced:
                # Already audible in the room — a different voice cannot take
                # over mid-utterance, so surface the failure instead.
                raise
            errors.append(f"{name}: {exc}")
            logger.warning("TTS backend %s failed: %s", name, str(exc)[:200])
    raise RuntimeError("TTS failed (" + "; ".join(errors)[:400] + ")")


def warm_up() -> None:
    """Preload the piper model so the first answer does not pay ONNX init."""
    if "piper" not in backend_order()[:1]:
        return
    try:
        get_piper_voice()
        logger.info("piper TTS warm")
    except Exception as exc:  # noqa: BLE001
        logger.warning("piper TTS warmup failed (%s) — will fall back to %s",
                       str(exc)[:200], "edge-tts")
