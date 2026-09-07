"""In-process reasoning providers — the single-service replacement for agent-brain.

LLM_PROVIDER switch (config.LLM_PROVIDER):
  gemini  -> google-adk LlmAgent on Gemini API (GEMINI_MODEL waterfall)
  bedrock -> google-adk LlmAgent + LiteLlm on AWS Bedrock (BEDROCK_MODELS waterfall)

Both build the same 18 FunctionTools whose closures call run_board_tool
directly — no NODE_URL/BRAIN_URL HTTP hop, no /tools/execute callback.
"""

from __future__ import annotations

import inspect
import os
from typing import Any, Optional

import config
from errors import AgentError
from logger import logger
from system_info import get_policy_metadata, get_static_instructions
from tools.definitions import TOOL_SPECS

try:
    import litellm as _litellm_global

    # Bedrock Converse requires alternating roles; without this LiteLLM
    # just merges consecutive user/tool blocks and warns factory.py:4435.
    _litellm_global.modify_params = True
except Exception:
    pass

_TYPE_MAP = {"str": str, "float": float, "bool": bool, "list": list, "dict": dict}

_instruction_cache: str | None = None


def get_instruction() -> str:
    global _instruction_cache
    if _instruction_cache is None:
        _instruction_cache = get_static_instructions()
    return _instruction_cache


def ensure_env_auth() -> None:
    if not os.environ.get("GOOGLE_GENAI_API_KEY") and config.GEMINI_API_KEY:
        os.environ["GOOGLE_GENAI_API_KEY"] = config.GEMINI_API_KEY


def summarize_args(args: dict) -> dict:
    summary: dict[str, Any] = {}
    for key, value in (args or {}).items():
        if isinstance(value, list) and value and isinstance(value[0], dict) and "x" in value[0]:
            summary[key] = f"[{len(value)} points]"
        elif isinstance(value, str) and len(value) > 80:
            summary[key] = value[:80] + "..."
        elif isinstance(value, (dict, list)):
            summary[key] = f"<{type(value).__name__} len={len(value)}>"
        else:
            summary[key] = value
    return summary


class DirectCaller:
    """Tool callback that runs run_board_tool in-process and tracks stats."""

    def __init__(self, ctx: dict, stats: dict):
        self._ctx = ctx
        self._stats = stats
        self.trace: list[dict] = []
        self._seen_chats: set[str] = set()

    def __call__(self, tool_name: str, args: dict) -> Any:
        from agent.board_runner import run_board_tool
        import time as _time
        cancel_event = self._ctx.get("cancelEvent")
        if cancel_event is not None and cancel_event.is_set():
            raise AgentError("agent_stopped", "Agent session stopped before tool execution")
        summary = summarize_args(args)
        self.trace.append({"tool": tool_name, "args": summary})
        # Circuit breaker: Nova sometimes loops same clarification
        # (e.g., 16x "are you sure you want me to remove the circle?")
        # Return an error so the model is forced to try a different tool
        # instead of burning all max_turns.
        if tool_name == "chalkboard_send_chat":
            msg = str((args or {}).get("message") or "").strip()
            if msg and msg in self._seen_chats:
                logger.warning("duplicate chat blocked tool=%s", tool_name)
                return {"content": [{"type": "text",
                                     "text": "You already sent that exact chat message in this turn. Do NOT repeat it. "
                                             "If the request was to remove/delete a single shape like 'the circle', "
                                             "call chalkboard_get_state to list strokes, identify its id, then "
                                             "chalkboard_select_and_transform with action=delete. "
                                             "Only ask for confirmation for bulk destructive actions (clear all / kick all)."}],
                        "isError": True}
            if msg:
                self._seen_chats.add(msg)
                # keep set small
                if len(self._seen_chats) > 20:
                    self._seen_chats.pop()
        _start = _time.perf_counter()
        try:
            return run_board_tool(self._ctx, self._stats, tool_name, args)
        finally:
            _ms = int((_time.perf_counter() - _start) * 1000)
            logger.info("tool=%s args=%s %sms", tool_name, summary, _ms)


def make_tool(name: str, description: str, params: list, caller: DirectCaller):
    sig_params = []
    annotations: dict[str, Any] = {}
    for pname, ptype, prequired in params:
        base = _TYPE_MAP[ptype]
        if prequired:
            default = inspect.Parameter.empty
            annotations[pname] = base
        else:
            default = None
            annotations[pname] = Optional[base]
        sig_params.append(inspect.Parameter(pname, inspect.Parameter.POSITIONAL_OR_KEYWORD,
                                            default=default, annotation=annotations[pname]))

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


def build_agent(model: str, caller: DirectCaller):
    """Build one LlmAgent for the active provider."""
    from google.adk.agents import LlmAgent

    ensure_env_auth()
    tools = [make_tool(name, desc, params, caller) for name, desc, params in TOOL_SPECS]
    generate_config: dict[str, Any] = {"temperature": 0.4}
    if config.THINKING_BUDGET > 0:
        generate_config["thinkingConfig"] = {"thinkingBudget": config.THINKING_BUDGET}
    if config.LLM_PROVIDER == "bedrock":
        from google.adk.models.lite_llm import LiteLlm
        import litellm as _litellm
        # Bedrock Converse requires alternating roles; consecutive
        # user/tool blocks would error without a dummy assistant turn.
        # This is a litellm global, not a Bedrock API param.
        _litellm.modify_params = True
        return LlmAgent(name="chalkboard_master",
                        description="Autonomous AI teaching assistant for the Chalkboard classroom.",
                        model=LiteLlm(model=model),
                        instruction=get_instruction(),
                        tools=tools,
                        generate_content_config=generate_config)
    return LlmAgent(name="chalkboard_master",
                    description="Autonomous AI teaching assistant for the Chalkboard classroom.",
                    model=model,
                    instruction=get_instruction(),
                    tools=tools,
                    generate_content_config=generate_config)


def _event_text(event) -> str:
    parts = getattr(getattr(event, "content", None), "parts", None) or []
    return "".join(getattr(p, "text", "") or "" for p in parts)


async def run_reasoning(message: str, user_id: str, ctx: dict, stats: dict,
                        request_id: str, max_turns: int) -> dict:
    """Run one reasoning task against the provider waterfall. Returns finalText/turns/model."""
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.adk.agents.run_config import RunConfig
    from google.genai import types as genai_types

    candidates = config.get_model_waterfall()
    policy = get_policy_metadata()
    session_service = InMemorySessionService()
    last_error: Exception | None = None

    for model in candidates:
        logger.debug("attempting model=%s provider=%s", model, config.LLM_PROVIDER)
        for attempt in range(max(1, config.MAX_RETRIES) + 1):
            try:
                caller = DirectCaller(ctx, stats)
                agent = build_agent(model, caller)
                runner = Runner(agent=agent, app_name="chalkboard",
                                session_service=session_service, auto_create_session=True)
                turns = 0
                final_text = ""
                last_text = ""
                async for event in runner.run_async(
                    user_id=user_id, session_id=request_id,
                    new_message=genai_types.Content(parts=[genai_types.Part(text=message)]),
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
                if not (final_text or "").strip():
                    final_text = last_text
                if final_text:
                    turns += 1
                logger.info("model succeeded model=%s turns=%s policy=%s/%s prompt_chars=%s",
                            model, turns, policy["version"], str(policy["sha256"])[:12], len(message))
                return {"finalText": final_text, "turns": turns, "model": model,
                        "trace": caller.trace, "policy": policy, "promptChars": len(message)}
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if ctx.get("cancelEvent") is not None and ctx["cancelEvent"].is_set():
                    raise AgentError("agent_stopped", "Agent session stopped") from exc
                msg = str(exc)
                retryable = any(s in msg for s in ("404", "NOT_FOUND", "not found", "503",
                                                  "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "exhausted"))
                logger.warning("model error model=%s: %s",
                               model, msg[:150])
                if retryable:
                    break
                if attempt >= config.MAX_RETRIES:
                    break
                import asyncio as _asyncio
                import random as _random
                await _asyncio.sleep(min(4.0, (2 ** attempt) + _random.random() * 0.3))
    raise last_error or RuntimeError("all models failed")
