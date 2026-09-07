"""Tool table parity + RBAC (mirrors test/executors.test.ts intent)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.definitions import EXPECTED_TOOL_NAMES, TOOL_SPECS
from tools.executors import TOOL_MIN_ROLE, can_invoker, forbidden_message


def test_tool_count_is_18():
    assert len(TOOL_SPECS) == 18
    assert len(EXPECTED_TOOL_NAMES) == 18
    assert len(set(EXPECTED_TOOL_NAMES)) == 18


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


def test_owner_only_tools():
    assert not can_invoker("instructor", "chalkboard_close_room")
    assert not can_invoker("instructor", "chalkboard_update_member_role")
    assert can_invoker("owner", "chalkboard_close_room")
    assert "owner" in forbidden_message("chalkboard_close_room", "viewer")
