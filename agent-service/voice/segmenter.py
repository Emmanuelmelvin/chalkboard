"""Energy-based VAD utterance segmenter (mirrors src/voice/utteranceSegmenter.ts)."""

from __future__ import annotations

import math


def frame_rms(frame) -> float:
    if len(frame) == 0:
        return 0.0
    s = 0.0
    for v in frame:
        n = int(v) / 32768
        s += n * n
    return math.sqrt(s / len(frame)) * 32768


class UtteranceSegmenter:
    def __init__(self, sample_rate: int = 16000, speech_rms: float = 500,
                 silence_end_ms: float = 900, min_utterance_ms: float = 600,
                 max_utterance_ms: float = 30000):
        self.sample_rate = sample_rate
        self.speech_rms = speech_rms
        self.silence_end_ms = silence_end_ms
        self.min_utterance_ms = min_utterance_ms
        self.max_utterance_ms = max_utterance_ms
        self._chunks: list = []
        self._samples = 0
        self._silence_ms = 0.0
        self._in_speech = False
        self._frame_ms: float | None = None

    def push(self, frame):
        import numpy as _np
        arr = _np.asarray(frame, dtype=_np.int16)
        if self._frame_ms is None and len(arr) > 0:
            self._frame_ms = (len(arr) / self.sample_rate) * 1000
        frame_ms = self._frame_ms or 10
        loud = frame_rms(arr) >= self.speech_rms
        if loud:
            self._in_speech = True
            self._silence_ms = 0
            self._chunks.append(arr.copy())
            self._samples += len(arr)
        elif self._in_speech:
            self._chunks.append(arr.copy())
            self._samples += len(arr)
            self._silence_ms += frame_ms
        else:
            return None
        utter_ms = (self._samples / self.sample_rate) * 1000
        if self._silence_ms >= self.silence_end_ms or utter_ms >= self.max_utterance_ms:
            return self._flush(utter_ms)
        return None

    def reset(self) -> None:
        self._chunks = []
        self._samples = 0
        self._silence_ms = 0.0
        self._in_speech = False

    def _flush(self, utter_ms: float):
        import numpy as _np
        chunks = self._chunks
        self.reset()
        if utter_ms < self.min_utterance_ms:
            return None
        if not chunks:
            return None
        pcm = _np.concatenate(chunks).astype(_np.int16)
        return {"pcm": pcm, "durationMs": round(utter_ms)}
