"""Chalkboard Master on AWS Bedrock via Google ADK (Python) + LiteLLM.

Owns the reasoning loop only. Every board mutation executes in the Node
agent-service through POST /tools/execute, so there is exactly one tool
implementation no matter which model reasons.
"""

import inspect
import json
import logging
import os
import re
import urllib.request
from typing import Any, Optional

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.agents.run_config import RunConfig
from google.genai import types

from toolspec import TOOL_SPECS

log = logging.getLogger("brain")

TYPE_MAP = {"str": str, "float": float, "bool": bool, "list": list, "dict": dict}

# Same neutralization as agent-service/src/agent/masterAgent.ts: ADK throws
# `Context variable not found` for any {identifier} in the instruction.
_TEMPLATE_RE = re.compile(r"\{+[^{}]*\}+")
_STATE_KEY_RE = re.compile(r"^(artifact\.[A-Za-z_]\w*|[A-Za-z_]\w*(?::[A-Za-z_]\w*)?)\??$")


def neutralize_templates(instruction: str) -> str:
    def _sub(m: re.Match) -> str:
        raw = m.group(0)
        inner = raw.strip("{}").strip()
        key = inner[:-1] if inner.endswith("?") else inner
        if _STATE_KEY_RE.match(key):
            return f"[{inner}]"
        return raw

    return _TEMPLATE_RE.sub(_sub, instruction)


def load_instruction() -> str:
    path = os.environ.get("BRAIN_SYSTEM_INFO", "../agent-service/SYSTEM_INFO.md")
    try:
        with open(path, encoding="utf-8") as f:
            return neutralize_templates(f.read())
    except OSError as exc:
        log.warning("SYSTEM_INFO not found at %s: %s", path, exc)
        return "You are Chalkboard Master, a friendly AI teaching assistant."


class NodeCaller:
    """Forwards tool calls to the Node agent-service and tracks stats."""

    def __init__(self, node_url: str, secret: str, room_id: str, invoker_role: str, request_id: str):
        self._node_url = node_url.rstrip("/")
        self._secret = secret
        self._room_id = room_id
        self._invoker_role = invoker_role
        self._request_id = request_id
        self.tool_calls = 0
        self.chat_sent = False

    def __call__(self, tool_name: str, args: dict) -> Any:
        self.tool_calls += 1
        if tool_name == "chalkboard_send_chat":
            self.chat_sent = True
        body = json.dumps({
            "roomId": self._room_id,
            "tool": tool_name,
            "args": args,
            "invokerRole": self._invoker_role,
            "requestId": self._request_id,
        }).encode()
        req = urllib.request.Request(
            f"{self._node_url}/tools/execute",
            data=body,
            headers={"Content-Type": "application/json", "x-agent-secret": self._secret},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                payload = json.loads(res.read().decode())
        except Exception as exc:
            log.warning("tool callback failed", extra={"tool": tool_name, "error": str(exc)[:200]})
            return {"content": [{"type": "text", "text": "That action could not be completed."}], "isError": True}
        if not payload.get("ok"):
            return {"content": [{"type": "text", "text": f"Tool failed: {payload.get('error', 'unknown')}"}], "isError": True}
        return payload.get("result")


def make_tool(name: str, description: str, params: list, caller: NodeCaller):
    """Build an ADK FunctionTool with an explicit signature (schema source)."""
    sig_params = []
    annotations = {}
    for pname, ptype, prequired in params:
        base = TYPE_MAP[ptype]
        if prequired:
            default = inspect.Parameter.empty
            annotations[pname] = base
        else:
            default = None
            annotations[pname] = Optional[base]
        sig_params.append(inspect.Parameter(pname, inspect.Parameter.POSITIONAL_OR_KEYWORD, default=default, annotation=annotations[pname]))

    def _impl(*args, **kwargs):
        bound = _SIG.bind(*args, **kwargs)
        bound.apply_defaults()
        call_args = {k: v for k, v in bound.arguments.items() if v is not None}
        return caller(name, call_args)

    _SIG = inspect.Signature(sig_params)
    _impl.__name__ = name
    _impl.__doc__ = description
    _impl.__signature__ = _SIG  # type: ignore[attr-defined]
    _impl.__annotations__ = annotations

    from google.adk.tools import FunctionTool
    return FunctionTool(_impl)


def build_agent(model: str, caller: NodeCaller) -> LlmAgent:
    tools = [make_tool(name, desc, params, caller) for name, desc, params in TOOL_SPECS]
    return LlmAgent(
        name="chalkboard_master",
        description="Autonomous AI teaching assistant for the Chalkboard classroom.",
        model=LiteLlm(model=model),
        instruction=load_instruction(),
        tools=tools,
    )


def _event_text(event) -> str:
    parts = getattr(getattr(event, "content", None), "parts", None) or []
    return "".join(getattr(p, "text", "") or "" for p in parts)


async def run_master(message: str, user_id: str, room_id: str, invoker_role: str,
                     request_id: str, max_turns: int, models: list) -> dict:
    """Run one reasoning task, trying each Bedrock model in order."""
    last_error: Exception | None = None
    node_url = os.environ.get("NODE_URL", "http://localhost:8080")
    secret = os.environ.get("AGENT_SECRET", "")
    session_service = InMemorySessionService()

    for model in models:
        log.info("brain attempting model %s request=%s", model, request_id)
        try:
            caller = NodeCaller(node_url, secret, room_id, invoker_role, request_id)
            agent = build_agent(model, caller)
            runner = Runner(agent=agent, app_name="chalkboard", session_service=session_service, auto_create_session=True)
            turns = 0
            final_text = ""
            last_text = ""
            async for event in runner.run_async(
                user_id=user_id,
                session_id=request_id,
                new_message=types.Content(parts=[types.Part(text=message)]),
                run_config=RunConfig(max_llm_calls=max_turns + 2),
            ):
                try:
                    calls = event.get_function_calls() or []
                except Exception:
                    calls = []
                if calls:
                    turns += 1
                text = _event_text(event)
                if text:
                    last_text = text
                try:
                    is_final = event.is_final_response()
                except Exception:
                    is_final = False
                if is_final and text:
                    final_text = text
            if not final_text.strip():
                final_text = last_text
            if final_text:
                turns += 1
            log.info("brain model succeeded %s turns=%d", model, turns)
            return {"finalText": final_text, "turns": turns, "chatSent": caller.chat_sent,
                    "toolCalls": caller.tool_calls, "model": model}
        except Exception as exc:  # noqa: BLE001 — fall through the model list
            last_error = exc
            log.warning("brain model failed %s: %s", model, str(exc)[:300])
    raise last_error or RuntimeError("all bedrock models failed")
