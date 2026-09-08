"""Validated runtime configuration for the Python Chalkboard Master agent-service.

Single service, no agent-brain. LLM_PROVIDER switches reasoning in-process:
  gemini  -> google-adk LlmAgent on Gemini API (GEMINI_MODEL + fallbacks)
  bedrock -> google-adk LlmAgent + LiteLlm on AWS Bedrock (BEDROCK_MODELS)
"""

from __future__ import annotations

import os

from pathlib import Path
from dotenv import load_dotenv

_agent_env = Path(__file__).resolve().parent / ".env"
if _agent_env.exists():
    load_dotenv(dotenv_path=_agent_env, override=True)
else:
    load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)).strip())
    except (ValueError, AttributeError):
        return default


def _str(name: str, default: str) -> str:
    val = os.environ.get(name, default)
    return val if isinstance(val, str) and val != "" else default


def _list(name: str, default: str) -> list[str]:
    raw = os.environ.get(name, default)
    return [m.strip() for m in raw.split(",") if m.strip()]


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


PORT: int = _int("PORT", 8080)
NODE_ENV: str = _str("NODE_ENV", "development")
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL: str = _str("GEMINI_MODEL", "gemini-3.8-flash")
FALLBACK_GEMINI_MODELS: list[str] = _list(
    "FALLBACK_GEMINI_MODELS", "gemini-3.7-flash,gemini-3.6-flash,gemini-3.1-flash"
)
MAX_RETRIES: int = _int("MAX_RETRIES", 3)
THINKING_BUDGET: int = _int("THINKING_BUDGET", 0)
MAIN_BACKEND_HTTP_URL: str = _str("MAIN_BACKEND_HTTP_URL", "http://localhost:3000").rstrip("/")
MAIN_BACKEND_SOCKET_URL: str = _str("MAIN_BACKEND_SOCKET_URL", "http://localhost:3000").rstrip("/")
AGENT_SECRET: str = os.environ.get("AGENT_SECRET", "").strip()
MAX_TURNS_PER_INSTRUCTION: int = _int("MAX_TURNS_PER_INSTRUCTION", 15)
REASONING_TIMEOUT_S: float = _int("REASONING_TIMEOUT_MS", 120000) / 1000.0

LLM_PROVIDER: str = os.environ.get("LLM_PROVIDER", "gemini").strip().lower()
if LLM_PROVIDER not in ("gemini", "bedrock"):
    LLM_PROVIDER = "gemini"

BEDROCK_MODELS: list[str] = _list(
    "BEDROCK_MODELS", "bedrock/us.amazon.nova-lite-v1:0"
)
AWS_REGION: str = _str("AWS_REGION", "us-east-1")
# Speech-to-text backend, independent of LLM_PROVIDER:
#   auto   -> gemini audio when LLM_PROVIDER=gemini, else local whisper
#   gemini -> Gemini audio understanding (needs GEMINI_API_KEY)
#   local  -> faster-whisper on CPU (needs requirements/optional/whisper.txt)
#   aws    -> Amazon Transcribe streaming (needs optional/transcribe.txt + IAM)
STT_BACKEND: str = os.environ.get("STT_BACKEND", "auto").strip().lower()
if STT_BACKEND not in ("auto", "gemini", "local", "aws"):
    STT_BACKEND = "auto"
STT_MODEL: str = _str("STT_MODEL", "base")
STT_LANGUAGE: str = os.environ.get("STT_LANGUAGE", "en").strip() or "en"
TTS_VOICE: str = _str("TTS_VOICE", "en-US-AriaNeural")
# Text-to-speech backend for the LiveKit publish path:
#   piper (default) local ONNX neural TTS — offline, no vendor endpoint
#   edge            Microsoft Edge read-aloud via edge-tts (network, no SLA)
# The other backend is used automatically if the primary produces no audio.
TTS_BACKEND: str = os.environ.get("TTS_BACKEND", "piper").strip().lower()
if TTS_BACKEND not in ("piper", "edge"):
    TTS_BACKEND = "piper"
PIPER_VOICE: str = _str("PIPER_VOICE", "en_US-amy-medium")
PIPER_VOICE_DIR: str = _str("PIPER_VOICE_DIR", str(Path(__file__).resolve().parent / "voices"))
# Convenience for local dev only. Production images bake the model in at build
# time, so the local backend never needs the network at request time.
PIPER_AUTO_DOWNLOAD: bool = _bool("PIPER_AUTO_DOWNLOAD", True)
LOG_LEVEL: str = _str("LOG_LEVEL", "info")


def get_gemini_models() -> list[str]:
    """Gemini candidates regardless of the active provider.

    Voice STT needs these explicitly: get_model_waterfall() returns Bedrock IDs
    in bedrock mode, and passing those to the Gemini audio client fails.
    """
    models = [GEMINI_MODEL, *FALLBACK_GEMINI_MODELS]
    return list(dict.fromkeys(m for m in models if m))


def get_model_waterfall() -> list[str]:
    """Ordered model candidates for the active provider."""
    if LLM_PROVIDER == "bedrock":
        seen = list(dict.fromkeys(BEDROCK_MODELS))
        return seen or ["bedrock/us.amazon.nova-lite-v1:0"]
    return get_gemini_models()


def resolve_stt_backend() -> str:
    """Concrete STT backend: gemini|local|aws. Resolves the `auto` default."""
    if STT_BACKEND != "auto":
        return STT_BACKEND
    # `auto` preserves the historical coupling: Gemini reasoning transcribed via
    # Gemini audio, Bedrock reasoning via local whisper.
    return "gemini" if LLM_PROVIDER == "gemini" else "local"


def validate_or_warn() -> None:
    import logging

    log = logging.getLogger("agent-service")
    # Fail closed: this shared secret is the only thing authenticating the
    # agent against the backend, so it must come from the environment and
    # match the backend's AGENT_SERVICE_SECRET. Never ship a default.
    if len(AGENT_SECRET) < 32:
        raise RuntimeError(
            "AGENT_SECRET is required (min 32 chars) and must match the backend's "
            "AGENT_SERVICE_SECRET. Generate one with: openssl rand -hex 32"
        )
    if LLM_PROVIDER == "gemini" and not GEMINI_API_KEY and NODE_ENV == "production":
        raise RuntimeError("GEMINI_API_KEY is required in production for LLM_PROVIDER=gemini")
    if LLM_PROVIDER == "gemini" and not GEMINI_API_KEY:
        log.warning("GEMINI_API_KEY is not set. Set it in .env to enable real AI generation.")
