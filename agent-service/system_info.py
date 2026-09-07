"""Immutable, model-facing policy loader.

The policy is packaged beside this module. It is deliberately not searched
from the working directory: a mounted file or changed launch directory must
never replace the agent's authority policy at runtime.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

_cached: str | None = None
_cached_sha256: str | None = None
_MAX_POLICY_CHARS = 12_000
POLICY_VERSION = "2026-09-07.3"


def _policy_path() -> Path:
    return Path(__file__).resolve().parent / "SYSTEM_INFO.md"


def load_system_info() -> str | None:
    global _cached, _cached_sha256
    if _cached is not None:
        return _cached
    try:
        raw = _policy_path().read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Model policy file is unavailable") from exc
    if not raw:
        raise RuntimeError("Model policy file is empty")
    if len(raw) > _MAX_POLICY_CHARS:
        raise RuntimeError(f"Model policy exceeds {_MAX_POLICY_CHARS} characters")
    if "{" in raw or "}" in raw:
        raise RuntimeError("Model policy must not contain unresolved template syntax")
    _cached = raw
    _cached_sha256 = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return raw


def get_static_instructions() -> str:
    return load_system_info()  # type: ignore[return-value]


def get_policy_metadata() -> dict[str, str | int]:
    policy = get_static_instructions()
    return {"version": POLICY_VERSION, "sha256": _cached_sha256 or "", "chars": len(policy)}


def _clear_cache_for_tests() -> None:
    global _cached, _cached_sha256
    _cached = None
    _cached_sha256 = None
