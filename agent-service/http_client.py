"""Outbound backend HTTP client (replaces src/http/httpClient.ts brainClient/backendClient).

No brain client remains — the only outbound HTTP is the LiveKit voice-token
fetch against the main backend.
"""

from __future__ import annotations

import urllib.request
import json

import config
from errors import AgentError


def backend_post(path: str, payload: dict, timeout_s: float = 15.0) -> tuple[int, dict]:
    url = f"{config.MAIN_BACKEND_HTTP_URL}{path}"
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json", "x-agent-secret": config.AGENT_SECRET},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as res:
            raw = res.read().decode()
            try:
                return res.status, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return res.status, {}
    except Exception as exc:
        raise AgentError("http_unreachable", f"backend unreachable: {exc}") from exc
