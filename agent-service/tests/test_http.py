"""HTTP contract tests (Flask test client, no network)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import os

os.environ.setdefault("AGENT_SECRET", "test-agent-secret-0123456789abcdef0123456789abcdef")
os.environ.setdefault("LLM_PROVIDER", "gemini")

import app as service
import config as service_config

SECRET = service_config.AGENT_SECRET
_HDR = {"x-agent-secret": SECRET}
_BEARER = {"Authorization": f"Bearer {SECRET}"}


def _client():
    service.app.config["TESTING"] = True
    return service.app.test_client()


def test_health_shape():
    res = _client().get("/health")
    assert res.status_code == 200
    body = res.get_json()
    assert body["service"] == "chalkboard-agent-service"
    assert body["provider"] in ("gemini", "bedrock")
    assert isinstance(body["activeRoomSessions"], int)


def test_auth_required():
    res = _client().post("/sessions/join", json={"roomId": "r1"})
    assert res.status_code == 401


def test_join_validation():
    c = _client()
    res = c.post("/sessions/join", json={}, headers=_HDR)
    assert res.status_code == 400
    res = c.post("/sessions/join", json={"roomId": "bad\x00id"},
                 headers=_HDR)
    assert res.status_code == 400


def test_status_404_and_bearer_auth():
    c = _client()
    res = c.get("/sessions/status/nonexistent", headers=_BEARER)
    assert res.status_code == 404
    res = c.post("/stop", json={"roomId": "x"}, headers=_BEARER)
    assert res.status_code == 200
