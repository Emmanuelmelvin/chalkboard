"""Chat sanitization helpers (mirrors src/agent/messageSanitizer.ts)."""

from __future__ import annotations

import random
import re

_NARRATION = [
    re.compile(r"\bhas asked (who|what|when|where|why|how|whether|if|about|me|for|to)\b", re.I),
    re.compile(r"\bis asking (who|what|when|where|why|how|whether|if|about|me|for|to)\b", re.I),
    re.compile(r"this does not seem to require", re.I),
    re.compile(r"doesn.?t require any (action|tool)", re.I),
    re.compile(r"no (specific |further )?(action|tools?) (is |are )?(needed|required)", re.I),
    re.compile(r"since .{1,60} is the owner", re.I),
    re.compile(r"\bi am allowed to\b", re.I),
    re.compile(r"\bi need to provide .* (directly )?(in|via|through) (the )?chat", re.I),
    re.compile(r"\bi (should|will) respond .* (directly )?(in|via|through) (the )?chat", re.I),
    re.compile(r"provide the information directly", re.I),
    re.compile(r"there is no specific request", re.I),
    re.compile(r"i should respond directly", re.I),
]


def sanitize_chat_message(text: str | None) -> str | None:
    if not text or not isinstance(text, str):
        return None
    trimmed = text.strip()
    if not trimmed:
        return None
    if re.match(r"^[\{\[]", trimmed) and re.search(r"[\}\]]$", trimmed):
        return None
    if re.match(r"^(?:Invalid command|Traceback|node:internal|UnhandledPromiseRejection)", trimmed, re.I):
        return None
    return trimmed


def strip_narration(text: str | None) -> str | None:
    if not text or not isinstance(text, str):
        return None
    sentences = re.split(r"(?<=[.!?])\s+", text)
    kept = [s for s in sentences if s.strip() and not any(rx.search(s) for rx in _NARRATION)]
    out = " ".join(kept).strip()
    return out or None


def get_friendly_error_message(display_name: str) -> str:
    return random.choice([
        f"I ran into a temporary hiccup while working on the chalkboard. Could you please ask again, {display_name}?",
        f"Sorry {display_name}, my connection to the board had a brief interruption. Please try asking once more!",
        "I hit a slight bump while updating the classroom. Let me know what you'd like me to explain or draw next!",
    ])
