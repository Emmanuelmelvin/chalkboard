"""Centralized loader for SYSTEM_INFO.md (mirrors src/utils/loadSystemInfo.ts)."""

from __future__ import annotations

import os
from pathlib import Path

_cached: str | None = None

_FALLBACK = (
    "You are Chalkboard Master, a friendly AI teaching assistant. Follow modality matching, "
    "canvas restraint, incremental word-by-word writing (1-3 words per call, textAlign left, "
    "preserve color/fontSize), permission inheritance (check invokerRole before any tool), "
    "and socratic clarification. Never leak internal meta-summaries."
)


def _candidates() -> list[Path]:
    here = Path(__file__).resolve().parent
    cwd = Path(os.getcwd()).resolve()
    return [
        here / "SYSTEM_INFO.md",
        cwd / "SYSTEM_INFO.md",
        cwd / "agent-service" / "SYSTEM_INFO.md",
        Path("/app/SYSTEM_INFO.md"),
        Path("/app/agent-service/SYSTEM_INFO.md"),
    ]


def load_system_info() -> str | None:
    global _cached
    if _cached is not None:
        return _cached
    for candidate in _candidates():
        try:
            if candidate.is_file():
                raw = candidate.read_text(encoding="utf-8").strip()
                if raw:
                    _cached = raw
                    return raw
        except OSError:
            continue
    return None


def get_static_instructions() -> str:
    return load_system_info() or _FALLBACK


def _clear_cache_for_tests() -> None:
    global _cached
    _cached = None
