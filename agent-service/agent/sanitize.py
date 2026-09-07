"""Chat sanitization helpers (mirrors src/agent/messageSanitizer.ts)."""

from __future__ import annotations

import random
import re

_NARRATION = [
    re.compile(r"\bhas asked (who|what|when|where|why|how|whether|if|about|me|for|to)\b", re.I),
    re.compile(r"\bis asking (who|what|when|where|why|how|whether|if|about|me|for|to)\b", re.I),
    # Third-person restatement of the request ("The requester wants to know ...")
    re.compile(r"\bthe (user|requester|student|teacher|classmate|member|instructor)s?\s+"
               r"(wants?|wanted?|asks?|asked|is\s+asking|was\s+asking|would\s+like|"
               r"needs?|needed|wondered?|requested|hopes?)\b", re.I),
    re.compile(r"\bthe (current |incoming )?(request|question|prompt|task|message|demand)\s+"
               r"(is|was|seems?|appears)\b.{0,60}\b(about|to|for|regarding|that)\b", re.I),
    # "According to the board state in the runtime context ..."
    re.compile(r"\baccording to (the|this|our|my)\b.{0,80}\b(context|state|metadata|snapshot|history|envelope)\b", re.I),
    re.compile(r"\b(runtime context|provided context|trusted runtime|in the runtime)\b", re.I),
    # "I will confirm this to the requester" / "I will inform the user"
    re.compile(r"\bi\s+(will|am\s+going\s+to|shall|can|could|must|need\s+to|would\s+like\s+to)\s+"
               r"(confirm|inform|notify|tell|let|reply|respond|answer|report|relay|share|send|communicate)\b"
               r".{0,40}\b(requester|user|classmate|them|him|her|the\s+(user|requester|classmate|room))\b", re.I),
    # Talking about calling tools in a user-facing message
    re.compile(r"\bi\s+(should|will|am\s+going\s+to)\s+(use|call|invoke)\s+(the\s+)?chalkboard_\w+", re.I),
    re.compile(r"\b(function|board)\s+tools?\b.{0,40}\b(call|invoke)\b", re.I),
    # Internal identifiers must never reach users
    re.compile(r"\b(mentionedUserIds|invokerRole|requestId|roomMetadata|system\s+prompt)\b", re.I),
    re.compile(r"\bno\s+tool\s+(calls?\s+)?(is|are)?\s*(needed|required|necessary)\b", re.I),
    re.compile(r"\bthis does not seem to require\b", re.I),
    re.compile(r"doesn.?t require any (action|tool)", re.I),
    re.compile(r"no (specific |further )?(action|tools?) (is |are )?(needed|required)", re.I),
    re.compile(r"since .{1,60} is the owner", re.I),
    re.compile(r"\bi am allowed to\b", re.I),
    re.compile(r"\bi need to provide .* (directly )?(in|via|through) (the )?chat", re.I),
    re.compile(r"\bi (should|will) respond .* (directly )?(in|via|through) (the )?chat", re.I),
    re.compile(r"provide the information directly", re.I),
    re.compile(r"there is no specific request", re.I),
    re.compile(r"i should respond directly", re.I),
    # "I should provide a summary of my capabilities based on the available tools."
    re.compile(r"\bi\s+(should|will|can|am\s+going\s+to|need\s+to|would\s+like\s+to)\s+"
               r"(provide|give|offer|present|share|summarize|summarise|list|outline|describe)\b"
               r".{0,80}\b(capabilit\w*|available\s+tools|registered\s+tools|function\s+tools|features?)\b", re.I),
    re.compile(r"\bbased on (the )?available tools\b", re.I),
    # "The toolResult indicates that ..." — commentary on tool output
    re.compile(r"\btool\s?results?\b.{0,30}\b(indicates?|says?|shows?|confirms?|suggests?|tells?)\b", re.I),

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
