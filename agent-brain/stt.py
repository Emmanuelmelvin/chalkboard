"""Speech-to-text via Amazon Transcribe streaming (Bedrock models take no audio).

Takes 16kHz mono s16le PCM (utterances are short, <=30s), streams it to
Transcribe, and returns the final transcript or None.
"""

import asyncio
import logging
import os

log = logging.getLogger("brain")

try:
    from amazon_transcribe.client import TranscribeStreamingClient
    from amazon_transcribe.handlers import TranscriptResultStreamHandler
    from amazon_transcribe.model import TranscriptEvent
    _AVAILABLE = True
except ImportError:  # pragma: no cover
    _AVAILABLE = False


class _Collector(TranscriptResultStreamHandler):
    def __init__(self, stream):
        super().__init__(stream)
        self.parts: list = []

    async def handle_transcript_event(self, event: TranscriptEvent):
        for result in event.transcript.results:
            if result.is_partial:
                continue
            for alt in result.alternatives:
                if alt.transcript:
                    self.parts.append(alt.transcript)


async def transcribe_pcm(pcm: bytes, timeout_s: float = 45.0) -> str | None:
    if not _AVAILABLE:
        raise RuntimeError("amazon-transcribe is not installed")
    if len(pcm) < 16000:  # <0.5s of 16kHz s16le, ignore
        return None
    region = os.environ.get("AWS_REGION", "us-east-1")
    client = TranscribeStreamingClient(region=region)
    stream = await client.start_stream_transcription(
        language_code="en-US",
        media_sample_rate_hz=16000,
        media_encoding="pcm",
    )
    handler = _Collector(stream.output_stream)

    async def _send():
        for i in range(0, len(pcm), 8192):
            await stream.input_stream.send_audio_event(audio_chunk=pcm[i:i + 8192])
        await stream.input_stream.end_stream()

    await asyncio.wait_for(asyncio.gather(_send(), handler.handle_events()), timeout=timeout_s)
    text = " ".join(handler.parts).strip()
    return text or None
