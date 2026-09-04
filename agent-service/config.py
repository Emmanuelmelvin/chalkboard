"""Validated runtime configuration for the Python Chalkboard Master agent-service.

Single service, no agent-brain. LLM_PROVIDER switches reasoning in-process:
  gemini  -> google-adk LlmAgent on Gemini API (GEMINI_MODEL + fallbacks)
  bedrock -> google-adk LlmAgent + LiteLlm on AWS Bedrock (BEDROCK_MODELS)
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

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
AGENT_SECRET: str = _str("AGENT_SECRET", "chalkboard_agent_internal_secret_key_2026")
MAX_TURNS_PER_INSTRUCTION: int = _int("MAX_TURNS_PER_INSTRUCTION", 15)
REASONING_TIMEOUT_S: float = _int("REASONING_TIMEOUT_MS", 120000) / 1000.0

LLM_PROVIDER: str = os.environ.get("LLM_PROVIDER", "gemini").strip().lower()
if LLM_PROVIDER not in ("gemini", "bedrock"):
    LLM_PROVIDER = "gemini"

BEDROCK_MODELS: list[str] = _list(
    "BEDROCK_MODELS", "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0"
)
AWS_REGION: str = _str("AWS_REGION", "us-east-1")
STT_BACKEND: str = os.environ.get("STT_BACKEND", "local").strip().lower()  # local|aws
STT_MODEL: str = _str("STT_MODEL", "base")
STT_LANGUAGE: str = os.environ.get("STT_LANGUAGE", "en").strip() or "en"
TTS_VOICE: str = _str("TTS_VOICE", "en-US-AriaNeural")
LOG_LEVEL: str = _str("LOG_LEVEL", "info" if NODE_ENV == "production" else "debug")


def get_model_waterfall() -> list[str]:
    """Ordered model candidates for the active provider."""
    if LLM_PROVIDER == "bedrock":
        seen = list(dict.fromkeys(BEDROCK_MODELS))
        return seen or ["bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0"]
    models = [GEMINI_MODEL, *FALLBACK_GEMINI_MODELS]
    return list(dict.fromkeys(m for m in models if m))


def validate_or_warn() -> None:
    import logging

    log = logging.getLogger("agent-service")
    if LLM_PROVIDER == "gemini" and not GEMINI_API_KEY and NODE_ENV == "production":
        raise RuntimeError("GEMINI_API_KEY is required in production for LLM_PROVIDER=gemini")
    if LLM_PROVIDER == "gemini" and not GEMINI_API_KEY:
        log.warning("GEMINI_API_KEY is not set. Set it in .env to enable real AI generation.")
