"""Dynamic activity telemetry engine (mirrors src/agent/activityFormatter.ts)."""

from __future__ import annotations

from typing import Any

_VERB_GERUND = {
    "add": "Adding", "apply": "Applying", "balance": "Balancing", "build": "Building",
    "calc": "Calculating", "calculate": "Calculating", "clear": "Clearing", "compile": "Compiling",
    "compute": "Computing", "connect": "Connecting", "create": "Creating", "delete": "Deleting",
    "discover": "Discovering", "display": "Displaying", "draw": "Drawing", "edit": "Editing",
    "erase": "Erasing", "evaluate": "Evaluating", "execute": "Executing", "export": "Exporting",
    "fetch": "Fetching", "find": "Finding", "format": "Formatting", "generate": "Generating",
    "get": "Retrieving", "graph": "Plotting graph for", "highlight": "Highlighting",
    "import": "Importing", "insert": "Inserting", "inspect": "Inspecting", "load": "Loading",
    "make": "Making", "manage": "Managing", "measure": "Measuring", "modify": "Modifying",
    "move": "Moving", "navigate": "Navigating", "pan": "Panning", "place": "Placing",
    "plot": "Plotting", "query": "Querying", "read": "Reading", "remove": "Removing",
    "render": "Rendering", "resize": "Resizing", "rotate": "Rotating", "run": "Running",
    "scale": "Scaling", "scan": "Scanning", "search": "Searching", "select": "Selecting",
    "send": "Sending", "simulate": "Simulating", "sketch": "Sketching", "solve": "Solving",
    "speak": "Speaking", "summarize": "Summarizing", "trace": "Tracing",
    "transform": "Transforming", "undo": "Undoing", "update": "Updating",
    "visualize": "Visualizing", "write": "Writing", "zoom": "Zooming",
}


def _title_case(text: str) -> str:
    import re
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    text = text.replace("_", " ").replace("-", " ")
    return " ".join(w[:1].upper() + w[1:] for w in text.split()).strip()


def synthesize_tool_action(tool_name: str) -> str:
    import re
    cleaned = re.sub(r"^(mcp|ext|tool)[_\-.]", "", tool_name, flags=re.I)
    cleaned = re.sub(r"^chalkboard[_\-]", "", cleaned, flags=re.I)
    tokens = [t for t in re.split(r"[_\-.]+", cleaned) if t]
    if not tokens:
        return "Executing Tool"
    first = tokens[0].lower()
    prefix = _VERB_GERUND.get(first)
    if prefix:
        rest = " ".join(_title_case(t) for t in tokens[1:])
        return f"{prefix} {rest}" if rest else f"{prefix}..."
    phrase = " ".join(_title_case(t) for t in tokens)
    if not phrase.endswith("ing") and not phrase.startswith(("Executing", "Running")):
        phrase = f"Executing {phrase}"
    return phrase


def synthesize_tool_summary(args: Any = None) -> str:
    if not isinstance(args, dict) or not args:
        return "Running tool action"
    for key in ("formula", "equation", "expression", "text", "message", "query", "prompt",
                "title", "name", "label", "symbol", "topic", "code", "command", "content",
                "type", "action", "pluginId", "element", "component"):
        val = args.get(key)
        if isinstance(val, str) and val.strip():
            truncated = val.strip()[:45] + ("..." if len(val.strip()) > 45 else "")
            return f"{_title_case(key)}: \"{truncated}\""
    if isinstance(args.get("x"), (int, float)) and isinstance(args.get("y"), (int, float)):
        extra = f" ({args['type']})" if args.get("type") else (f" ({args['color']})" if args.get("color") else "")
        return f"At ({round(args['x'])}, {round(args['y'])}){extra}"
    if isinstance(args.get("points"), list) and args["points"]:
        return f"Drawing {len(args['points'])} points ({args.get('color') or 'chalk'})"
    entries = [(k, v) for k, v in args.items() if v is not None and k != "roomId"][:3]
    if entries:
        parts = []
        for k, v in entries:
            ck = _title_case(k)
            if isinstance(v, str):
                parts.append(f"{ck}: \"{v[:20]}{'...' if len(v) > 20 else ''}\"")
            elif isinstance(v, (int, float, bool)):
                parts.append(f"{ck}: {v}")
            elif isinstance(v, list):
                parts.append(f"{ck}: [{len(v)} items]")
            else:
                parts.append(ck)
        return ", ".join(parts)
    return "Parameters configured"


def format_tool_activity(tool_name: str, args: Any = None) -> dict:
    return {"toolAction": synthesize_tool_action(tool_name),
            "toolSummary": synthesize_tool_summary(args)}


def extract_cursor_position(tool_name: str, args: Any = None) -> dict | None:
    if not isinstance(args, dict):
        return None
    if isinstance(args.get("x"), (int, float)) and isinstance(args.get("y"), (int, float)):
        return {"x": args["x"], "y": args["y"]}
    for key in ("position", "center", "target", "coords", "location", "point", "start", "origin"):
        obj = args.get(key)
        if isinstance(obj, dict) and isinstance(obj.get("x"), (int, float)) and isinstance(obj.get("y"), (int, float)):
            return {"x": obj["x"], "y": obj["y"]}
    for key in ("points", "path", "vertices", "coordsList", "polyline"):
        lst = args.get(key)
        if isinstance(lst, list) and lst:
            first = lst[0]
            if isinstance(first, dict) and isinstance(first.get("x"), (int, float)):
                return {"x": first["x"], "y": first["y"]}
    if isinstance(args.get("minX"), (int, float)) and isinstance(args.get("maxX"), (int, float)):
        cx = (args["minX"] + args["maxX"]) / 2
        cy = (args.get("minY", 0) + args.get("maxY", 0)) / 2 if isinstance(args.get("minY"), (int, float)) else 0
        return {"x": cx, "y": cy}
    return None
