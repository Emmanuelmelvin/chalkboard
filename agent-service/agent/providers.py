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
import re
from typing import Any, Optional

import config
from logger import logger
from system_info import get_static_instructions
from tools.definitions import TOOL_SPECS

_TYPE_MAP = {"str": str, "float": float, "bool": bool, "list": list, "dict": dict}

_TEMPLATE_RE = re.compile(r"\{+[^{}]*\}+")
_STATE_KEY_RE = re.compile(r"^(artifact\.[A-Za-z_]\w*|[A-Za-z_]\w*(?::[A-Za-z_]\w*)?)\??$")

_instruction_cache: str | None = None


def neutralize_templates(instruction: str) -> str:
    def _sub(m: re.Match) -> str:
        raw = m.group(0)
        inner = raw.strip("{}").strip()
        key = inner[:-1] if inner.endswith("?") else inner
        if _STATE_KEY_RE.match(key):
            return f"[{inner}]"
        return raw

    return _TEMPLATE_RE.sub(_sub, instruction)


def get_instruction() -> str:
    global _instruction_cache
    if _instruction_cache is None:
        _instruction_cache = neutralize_templates(get_static_instructions())
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

    def __call__(self, tool_name: str, args: dict) -> Any:
        from agent.board_runner import run_board_tool
        self.trace.append({"tool": tool_name, "args": summarize_args(args)})
        logger.info("tool call tool=%s args=%s", tool_name, summarize_args(args))
        return run_board_tool(self._ctx, self._stats, tool_name, args)


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
    session_service = InMemorySessionService()
    last_error: Exception | None = None

    for model in candidates:
        logger.info("attempting model=%s request=%s provider=%s", model, request_id, config.LLM_PROVIDER)
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
                logger.info("model succeeded model=%s turns=%s tools=%s", model, turns, stats.get("toolCalls"))
                return {"finalText": final_text, "turns": turns, "model": model, "trace": caller.trace}
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                msg = str(exc)
                retryable = any(s in msg for s in ("404", "NOT_FOUND", "not found", "503",
                                                  "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "exhausted"))
                logger.warning("model error model=%s attempt=%s advance=%s: %s",
                               model, attempt + 1, retryable, msg[:300])
                if retryable:
                    break
                if attempt >= config.MAX_RETRIES:
                    break
                import asyncio as _asyncio
                import random as _random
                await _asyncio.sleep(min(4.0, (2 ** attempt) + _random.random() * 0.3))
    raise last_error or RuntimeError("all models failed")
