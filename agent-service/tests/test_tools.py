"""Tool table parity + RBAC"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.definitions import EXPECTED_TOOL_NAMES, TOOL_SPECS
from tools.executors import TOOL_MIN_ROLE, can_invoker, forbidden_message, valid_points
from tools.shapes import generate_shape_strokes


def test_tool_count_is_20():
    assert len(TOOL_SPECS) == 20
    assert len(EXPECTED_TOOL_NAMES) == 20
    assert len(set(EXPECTED_TOOL_NAMES)) == 20
    assert "chalkboard_respond" in EXPECTED_TOOL_NAMES


def test_shape_and_cursor_controls_are_registered():
    specs = {name: params for name, _, params in TOOL_SPECS}
    assert {"radius", "color", "size", "intensity", "fillColor"} <= {name for name, _, _ in specs["chalkboard_insert_shape"]}
    assert {name for name, _, required in specs["chalkboard_move_cursor"] if required} == {"x", "y"}


def test_write_text_requires_text_x_y():
    spec = dict((n, (d, p)) for n, d, p in TOOL_SPECS)["chalkboard_write_text"]
    _, params = spec
    by_name = {name: (typ, req) for name, typ, req in params}
    assert by_name["text"][1] is True
    assert by_name["x"][1] is True
    assert by_name["y"][1] is True


def test_viewer_cannot_draw():
    assert not can_invoker("viewer", "chalkboard_draw_chalk")
    assert not can_invoker("viewer", "chalkboard_write_text")
    assert can_invoker("viewer", "chalkboard_send_chat")
    assert can_invoker("viewer", "chalkboard_get_state")
    assert not can_invoker("viewer", "chalkboard_move_cursor")


def test_canvas_points_match_backend_finite_coordinate_contract():
    assert valid_points([{"x": -10_000_000, "y": 10_000_000}])
    assert not valid_points([{"x": float("nan"), "y": 0}])
    assert not valid_points([{"x": float("inf"), "y": 0}])
    assert not valid_points([{"x": 10_000_001, "y": 0}])
    assert not valid_points([{"x": True, "y": 0}])


def test_owner_only_tools():
    assert not can_invoker("instructor", "chalkboard_close_room")
    assert not can_invoker("instructor", "chalkboard_update_member_role")
    assert can_invoker("owner", "chalkboard_close_room")
    assert "owner" in forbidden_message("chalkboard_close_room", "viewer")


def test_toggle_hand_description_claims_participant_capability():
    """Regression: the terse 'Raises or lowers hand.' description made Nova
    refuse with 'I can't raise my hand' without calling the tool. The
    description must explicitly state the agent itself has a hand."""
    spec = dict((n, (d, p)) for n, d, p in TOOL_SPECS)["chalkboard_toggle_hand"]
    description = spec[0].lower()
    assert "your own hand" in description
    assert "never claim you cannot" in description


def test_agent_shape_math_matches_frontend_geometry_contract():
    """Regression guard for the Python port of frontend/components/shapes."""
    rectangle = generate_shape_strokes({"shape": "rectangle", "cx": 100, "cy": 200, "radius": 80})[0]
    assert rectangle["points"] == [
        {"x": 36.0, "y": 160.0}, {"x": 164.0, "y": 160.0},
        {"x": 164.0, "y": 240.0}, {"x": 36.0, "y": 240.0},
    ]
    diamond = generate_shape_strokes({"shape": "diamond", "cx": 0, "cy": 0, "radius": 80})[0]
    assert diamond["points"] == [
        {"x": 0, "y": -80}, {"x": 52.0, "y": 0},
        {"x": 0, "y": 80}, {"x": -52.0, "y": 0},
    ]
    circle = generate_shape_strokes({"shape": "circle", "cx": 0, "cy": 0, "radius": 80})[0]
    heart = generate_shape_strokes({"shape": "heart", "cx": 0, "cy": 0, "radius": 80})[0]
    assert len(circle["points"]) == len(heart["points"]) == 48
    assert generate_shape_strokes({"shape": "not-a-shape"}) == []
