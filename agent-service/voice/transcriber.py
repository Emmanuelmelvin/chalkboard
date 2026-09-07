"""Speech-to-text for voice utterances.

Provider switch is internal (no agent-brain):
  LLM_PROVIDER=gemini  -> in-process ADK transcriber agent (Gemini audio)
  LLM_PROVIDER=bedrock -> local faster-whisper (STT_BACKEND=local, default)
                          or Amazon Transcribe streaming (STT_BACKEND=aws)

Mirrors src/voice/transcriber.ts + agent-brain/stt.py + stt_aws.py.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import re
import struct
import wave

import config
from logger import logger

VOICE_WAKE_PATTERN = re.compile(
    r"(chalkboard\s*master|\bmaster\b|\bhey ai\b|\bok ai\b|\bhey agent\b|\bcomputer\b)", re.I)


def is_agent_addressed(transcript: str) -> bool:
    return bool(VOICE_WAKE_PATTERN.search(transcript or ""))


def encode_wav(pcm_bytes: bytes, sample_rate: int) -> bytes:
    """Wrap mono s16le PCM bytes in a WAV container."""
    import numpy as _np
    arr = _np.frombuffer(pcm_bytes, dtype=_np.int16) if isinstance(pcm_bytes, bytes) else pcm_bytes
    raw = arr.tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(raw)
    return buf.getvalue()


def pcm_to_wav_base64(pcm, sample_rate: int) -> str:
    import numpy as _np
    arr = _np.asarray(pcm, dtype=_np.int16)
    return base64.b64encode(encode_wav(arr.tobytes(), sample_rate)).decode()


# ---- local whisper backend (ported from agent-brain/stt.py) ----

_local_model = None


def _get_local_model():
    global _local_model
    if _local_model is None:
        from faster_whisper import WhisperModel
        log = logging.getLogger("agent-service")
        log.info("loading local STT model %s", config.STT_MODEL)
        _local_model = WhisperModel(config.STT_MODEL, device="cpu", compute_type="int8")
    return _local_model


def transcribe_local(pcm_bytes: bytes) -> str | None:
    model = _get_local_model()
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(pcm_bytes)
    audio.seek(0)
    language = config.STT_LANGUAGE or None
    segments, _info = model.transcribe(audio, beam_size=5, vad_filter=True, language=language)
    kept = []
    for s in segments:
        if getattr(s, "no_speech_prob", 0) > 0.6:
            continue
        if (s.text or "").strip():
            kept.append(s.text.strip())
    return " ".join(kept) or None


async def _transcribe_local_async(pcm_bytes: bytes, timeout_s: float = 60.0) -> str | None:
    loop = asyncio.get_running_loop()
    return await asyncio.wait_for(loop.run_in_executor(None, transcribe_local, pcm_bytes), timeout=timeout_s)


async def _transcribe_aws(pcm_bytes: bytes, timeout_s: float = 45.0) -> str | None:
    try:
        from amazon_transcribe.client import TranscribeStreamingClient
        from amazon_transcribe.handlers import TranscriptResultStreamHandler
    except ImportError as exc:
        raise RuntimeError("amazon-transcribe is not installed") from exc

    parts: list[str] = []

    class _Collector(TranscriptResultStreamHandler):
        async def handle_transcript_event(self, event):
            for result in event.transcript.results:
                if result.is_partial:
                    continue
                for alt in result.alternatives:
                    if alt.transcript:
                        parts.append(alt.transcript)

    client = TranscribeStreamingClient(region=config.AWS_REGION)
    stream = await client.start_stream_transcription(
        language_code="en-US", media_sample_rate_hz=16000, media_encoding="pcm")
    handler = _Collector(stream.output_stream)

    async def _send():
        for i in range(0, len(pcm_bytes), 8192):
            await stream.input_stream.send_audio_event(audio_chunk=pcm_bytes[i:i + 8192])
        await stream.input_stream.end_stream()

    await asyncio.wait_for(asyncio.gather(_send(), handler.handle_events()), timeout=timeout_s)
    return " ".join(parts).strip() or None


def transcribe_utterance_blocking(pcm, sample_rate: int) -> str | None:
    """Blocking entry used by the voice listener thread. Never raises."""
    import numpy as _np
    try:
        arr = _np.asarray(pcm, dtype=_np.int16)
        if len(arr) < sample_rate // 2:  # <0.5s, ignore
            return None
        pcm_bytes = arr.tobytes()
        if len(encode_wav(pcm_bytes, sample_rate)) > 2 * 1024 * 1024:
            return None
        if config.LLM_PROVIDER == "bedrock":
            if (config.STT_BACKEND or "local") == "aws":
                return asyncio.run(_transcribe_aws(pcm_bytes))
            return asyncio.run(_transcribe_local_async(pcm_bytes))
        return asyncio.run(_transcribe_gemini(arr, sample_rate))
    except Exception as exc:  # noqa: BLE001 — voice must never crash
        logger.warning("transcription failed, skipping utterance: %s", exc)
        return None


async def _transcribe_gemini(arr, sample_rate: int) -> str | None:
    from google.adk.agents import LlmAgent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types

    if not os.environ.get("GOOGLE_GENAI_API_KEY") and config.GEMINI_API_KEY:
        os.environ["GOOGLE_GENAI_API_KEY"] = config.GEMINI_API_KEY
    wav = encode_wav(arr.tobytes(), sample_rate)
    if len(wav) > 2 * 1024 * 1024:
        return None
    candidates = config.get_model_waterfall()[:2]
    last_error: Exception | None = None
    sessions = InMemorySessionService()
    for model in candidates:
        try:
            agent = LlmAgent(
                name="voice_transcriber",
                description="Transcribes classroom voice utterances exactly.",
                model=model,
                instruction="Transcribe the attached classroom audio exactly. Reply with only the "
                            "transcription, no commentary. If there is no intelligible speech, reply exactly NO_SPEECH.",
                tools=[],
            )
            runner = Runner(agent=agent, app_name="chalkboard", session_service=sessions)
            stream = runner.run_async(
                user_id="voice-transcriber", session_id="voice",
                new_message={"parts": [{"inlineData": {
                    "mimeType": "audio/wav", "data": base64.b64encode(wav).decode()}}]},
            )
            final_text = ""
            last_text = ""
            async for event in stream:
                parts = getattr(getattr(event, "content", None), "parts", None) or []
                text = "".join(getattr(p, "text", "") or "" for p in parts)
                if text:
                    last_text = text
                try:
                    is_final = event.is_final_response()
                except Exception:
                    is_final = False
                if is_final and text:
                    final_text = text
            out = (final_text or last_text).strip()
            if not out or out == "NO_SPEECH":
                return None
            return out
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            logger.warning("transcription attempt failed model=%s: %s", model, exc)
    if last_error:
        raise last_error
    return None
