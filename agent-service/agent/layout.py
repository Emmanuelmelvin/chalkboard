"""Spatial layout analysis (mirrors src/agent/canvasLayout.ts)."""

from __future__ import annotations


def compute_canvas_bounds(strokes: list[dict]) -> dict | None:
    if not strokes:
        return None
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    has = False
    for s in strokes:
        for p in s.get("points") or []:
            if isinstance(p.get("x"), (int, float)) and isinstance(p.get("y"), (int, float)):
                has = True
                min_x = min(min_x, p["x"]); min_y = min(min_y, p["y"])
                max_x = max(max_x, p["x"]); max_y = max(max_y, p["y"])
        if isinstance(s.get("noteWidth"), (int, float)) and isinstance(s.get("noteHeight"), (int, float)):
            p0 = (s.get("points") or [None])[0]
            if isinstance(p0, dict):
                has = True
                max_x = max(max_x, p0["x"] + s["noteWidth"])
                max_y = max(max_y, p0["y"] + s["noteHeight"])
    if not has or min_x == float("inf"):
        return None
    return {"minX": round(min_x), "minY": round(min_y), "maxX": round(max_x), "maxY": round(max_y)}


def analyze_canvas_layout(strokes: list[dict]) -> dict:
    bounds = compute_canvas_bounds(strokes)
    if not bounds:
        return {"totalStrokes": 0, "bounds": None,
                "suggestedOriginBelow": {"x": 0, "y": 0},
                "suggestedOriginRight": {"x": 0, "y": 0}}
    return {"totalStrokes": len(strokes), "bounds": bounds,
            "suggestedOriginBelow": {"x": bounds["minX"], "y": bounds["maxY"] + 90},
            "suggestedOriginRight": {"x": bounds["maxX"] + 120, "y": bounds["minY"]}}


def format_spatial_layout_prompt(strokes: list[dict]) -> str:
    layout = analyze_canvas_layout(strokes)
    if not layout["bounds"]:
        return "- Canvas Layout: Clean/Empty board. Default origin (x: 0, y: 0) or center (x: 0, y: 80) is optimal."
    b = layout["bounds"]
    w, h = b["maxX"] - b["minX"], b["maxY"] - b["minY"]
    below = layout["suggestedOriginBelow"]; right = layout["suggestedOriginRight"]
    return (
        "- Canvas Layout (Active Board Geometry):\n"
        f"  * Occupied Bounds: X [{b['minX']}..{b['maxX']}], Y [{b['minY']}..{b['maxY']}]"
        f" (size: {w}w x {h}h, {layout['totalStrokes']} strokes)\n"
        "  * Placement Guidance: DO NOT overwrite occupied area.\n"
        "  * Recommended Clean Origin:\n"
        f"    - Below existing content: (x: {below['x']}, y: {below['y']})\n"
        f"    - Beside existing content: (x: {right['x']}, y: {right['y']})"
    )
