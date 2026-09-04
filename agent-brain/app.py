"""agent-brain HTTP service: ADK reasoning on Bedrock + Transcribe STT for Node."""

import asyncio
import base64
import logging
import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()  # local dev only: real deployments inject env directly (never overridden)

from master import run_master
from stt import transcribe_pcm
from toolspec import EXPECTED_TOOL_NAMES

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("brain")

app = Flask(__name__)

SECRET = os.environ.get("AGENT_SECRET", "")
MODELS = [m.strip() for m in os.environ.get(
    "BEDROCK_MODELS", "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0").split(",") if m.strip()]
RUN_TIMEOUT_S = float(os.environ.get("BRAIN_RUN_TIMEOUT_S", "110"))


def _authorized() -> bool:
    return bool(SECRET) and request.headers.get("x-agent-secret") == SECRET


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "chalkboard-agent-brain", "models": MODELS,
                    "tools": len(EXPECTED_TOOL_NAMES)})


@app.post("/run")
def run():
    if not _authorized():
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    body = request.get_json(force=True, silent=True) or {}
    message = (body.get("message") or "").strip()
    room_id = (body.get("roomId") or "").strip()
    if not message or not room_id:
        return jsonify({"ok": False, "error": "message and roomId required"}), 400
    invoker_role = body.get("invokerRole", "instructor")
    if invoker_role not in ("owner", "instructor", "viewer"):
        invoker_role = "instructor"
    try:
        result = asyncio.run(asyncio.wait_for(
            run_master(
                message=message,
                user_id=str(body.get("userId") or "Classmate"),
                room_id=room_id,
                invoker_role=invoker_role,
                request_id=str(body.get("requestId") or "brain"),
                max_turns=int(body.get("maxTurns") or 15),
                models=MODELS,
            ),
            timeout=RUN_TIMEOUT_S,
        ))
    except asyncio.TimeoutError:
        return jsonify({"ok": False, "error": "timeout"}), 504
    except Exception as exc:  # noqa: BLE001
        log.warning("run failed: %s", str(exc)[:300])
        return jsonify({"ok": False, "error": "run_failed"}), 500
    return jsonify({"ok": True, **result})


@app.post("/transcribe")
def transcribe():
    if not _authorized():
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    body = request.get_json(force=True, silent=True) or {}
    try:
        pcm = base64.b64decode(body.get("wavBase64") or "")
    except Exception:
        return jsonify({"ok": False, "error": "bad audio"}), 400
    # Strip 44-byte WAV header when present; Node sends 16kHz mono s16le.
    if len(pcm) > 44 and pcm[0:4] == b"RIFF":
        pcm = pcm[44:]
    if len(pcm) < 16000:
        return jsonify({"ok": True, "text": None})
    try:
        text = asyncio.run(transcribe_pcm(pcm))
    except Exception as exc:  # noqa: BLE001
        log.warning("transcribe failed: %s", str(exc)[:300])
        return jsonify({"ok": False, "error": "transcribe_failed"}), 500
    return jsonify({"ok": True, "text": text})


if __name__ == "__main__":
    port = int(os.environ.get("BRAIN_PORT", "8081"))
    app.run(host="0.0.0.0", port=port, threaded=True)
