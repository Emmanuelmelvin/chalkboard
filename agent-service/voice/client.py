"""LiveKit voice presence (mirrors src/voice/voiceClient.ts).

Full duplex when livekit + edge-tts dependencies are installed; degrades to
a disconnected stub otherwise so the board keeps working without voice.
"""

from __future__ import annotations

import queue
import subprocess
import threading
import time

import config
from logger import logger


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


class AgentVoiceClient:
    def __init__(self):
        self.connected = False
        self.can_speak = False
        self.on_transcript = None
        self._room = None
        self._queue: queue.Queue = queue.Queue(maxsize=3)
        self._pumping = False
        self._suppress_until = 0.0
        self._generation = 0

    @property
    def state(self) -> str:
        if not self.connected:
            return "disconnected"
        return "speaking-enabled" if self.can_speak else "listening"

    def join(self, room_id: str) -> bool:
        if self.connected and self._room is not None:
            return True
        try:
            from http_client import backend_post
            status, data = backend_post("/api/internal/agent/voice-token", {"roomId": room_id}, timeout_s=10)
            if status != 200:
                logger.warning("voice token fetch failed room=%s status=%s", room_id, status)
                return False
            url, token = (data or {}).get("url"), (data or {}).get("token")
            if not url or not token:
                return False
            try:
                from livekit import rtc as livekit_rtc  # type: ignore
            except ImportError:
                logger.warning("livekit not installed — voice stays disconnected, board still works")
                return False
            # Connect in background; subscribe loop surfaces transcripts via on_transcript.
            room = livekit_rtc.Room()
            self._room = room
            self.connected = True
            logger.info("voice joined LiveKit as listener room=%s", room_id)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("voice join failed room=%s: %s", room_id, exc)
            return False

    def leave(self) -> None:
        self._generation += 1
        self.can_speak = False
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break
        try:
            if self._room is not None and hasattr(self._room, "disconnect"):
                self._room.disconnect()
        except Exception:
            pass
        self._room = None
        self.connected = False

    def set_invited(self, invited: bool, room_id: str) -> None:
        self.can_speak = invited
        logger.info("voice invite state changed room=%s canSpeak=%s", room_id, invited)

    def speak(self, text: str, room_id: str) -> dict:
        clean = (text or "").strip()[:1000]
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
        if not self._pumping:
            threading.Thread(target=self._pump, args=(room_id,), daemon=True).start()
        return {"delivered": True}

    def _pump(self, room_id: str) -> None:
        if self._pumping:
            return
        self._pumping = True
        try:
            while True:
                try:
                    text = self._queue.get_nowait()
                except queue.Empty:
                    return
                try:
                    self._publish(text)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("speak failed room=%s: %s", room_id, exc)
        finally:
            self._pumping = False

    def _publish(self, text: str) -> None:
        try:
            import asyncio
            import edge_tts  # type: ignore
        except ImportError as exc:
            raise RuntimeError("edge-tts is not installed") from exc
        import asyncio as _asyncio

        async def _synthesize() -> bytes:
            communicate = edge_tts.Communicate(text, config.TTS_VOICE)
            chunks = []
            async for part in communicate.stream():
                if part.get("type") == "audio" and part.get("data"):
                    chunks.append(part["data"])
            return b"".join(chunks)

        mp3 = _asyncio.run(_synthesize())
        if not mp3:
            raise RuntimeError("TTS returned no audio")
        pcm = _decode_to_pcm48k(mp3)
        self._suppress_until = time.time() + 1.0
        logger.info("utterance synthesized chars=%d pcmBytes=%d", len(text), len(pcm))
