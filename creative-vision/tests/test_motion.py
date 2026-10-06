import json
import math
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "creative-vision"))
sys.path.insert(0, str(ROOT))
from src.motion import Director, parse_plan  # noqa: E402

SIZE = (480, 480)


def plan(**changes) -> dict:
    """A small plan in the director's format: a still hook, a line that rises in, and a wiggle on one word."""
    base = {
        "slide": "inputs/slide-01.png", "concept": "story", "hook_line": "l1", "duration": 6.0, "brand": False,
        "lines": [
            {"id": "l1", "role": "headline", "box": [40, 60, 440, 120], "size": 48,
             "runs": [{"text": "I'm", "rose": False}, {"text": "not", "rose": True}, {"text": "tired.", "rose": False}]},
            {"id": "l2", "role": "body", "box": [40, 200, 440, 250], "size": 40,
             "runs": [{"text": "I just woke up.", "rose": False}]},
        ],
        "motion": [
            {"line": "l1", "effect": "none", "at": 0},
            {"line": "l2", "effect": "rise", "at": 0.6, "dur": 0.45, "stagger": 0.03},
            {"line": "l1", "words": [1, 2], "effect": "wiggle", "at": 1.3, "dur": 0.5, "amount": 1.1},
        ],
        "camera": {"from": 1.0, "to": 1.03}, "scene_prompt": "She blinks.", "protect": [{"label": "child", "box": [0, 0, 1, 1]}],
    }
    return base | changes


def encoded(value: dict) -> bytes:
    return json.dumps(value).encode()


def drawn(director: Director, t: float) -> Image.Image:
    canvas = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    director.draw(canvas, t)
    return canvas


def ink(image: Image.Image, box) -> int:
    return image.getchannel("A").crop(box).point(lambda v: 1 if v > 40 else 0).histogram()[1]


def test_a_director_plan_parses_and_ignores_fields_finishing_does_not_use():
    parsed = parse_plan(encoded(plan()), SIZE)
    assert [line["id"] for line in parsed["lines"]] == ["l1", "l2"]
    assert parsed["motion"][2] == {"line": "l1", "effect": "wiggle", "at": 1.3, "stagger": 0.0, "dur": 0.5,
                                   "amount": 1.1, "words": [1, 2]}
    assert set(parsed) == {"lines", "motion", "brand"}  # No camera: the photo never moves in finishing.


@pytest.mark.parametrize("change", [
    {"lines": []},
    {"lines": [{"id": "l1", "role": "comic-sans", "box": [0, 0, 10, 10], "runs": [{"text": "x"}]}]},
    {"lines": [{"id": "l1", "box": [0, 0, 10, 10], "runs": [{"text": "x"}], "size": 9000}]},
    {"lines": [{"id": "l1", "box": [0, 0, math.nan, 10], "runs": [{"text": "x"}]}]},
    {"lines": [{"id": "l1", "box": [10, 0, 0, 10], "runs": [{"text": "x"}]}]},
    {"lines": [{"id": "l1", "box": [0, 0, 10, 10], "runs": [{"text": "x" * 301}]}]},
    {"lines": [{"id": "l1", "box": [0, 0, 10, 10], "runs": [{"text": "x"}]}] * 2},
    {"motion": [{"line": "l9", "effect": "rise"}]},
    {"motion": [{"line": "l1", "effect": "explode"}]},
    {"motion": [{"line": "l1", "effect": "rise", "at": 99}]},
    {"motion": [{"line": "l1", "effect": "rise", "words": [0, "all"]}]},
    {"motion": [{"line": "l1", "effect": "rise", "dur": True}]},
    {"brand": "../../secrets.png"},
])
def test_plans_outside_the_format_are_rejected(change):
    with pytest.raises(ValueError):
        parse_plan(encoded(plan(**change)), SIZE)


def test_non_json_and_oversized_plans_are_rejected():
    for data in (b"\xff\xfe", b"[1, 2]", b"{" + b" " * 200_001 + b"}"):
        with pytest.raises(ValueError):
            parse_plan(data, SIZE)


def test_timing_comes_from_the_cues():
    director = Director.from_plan(parse_plan(encoded(plan()), SIZE), SIZE)
    # l2 has four words, staggered 0.03 s: the last starts at 0.69 and is in by 1.14. The wiggle ends at 1.8.
    assert director.lines == 2 and director.text_in_by == 1.14 and director.settled_at == pytest.approx(1.8)


def test_hook_is_on_frame_zero_and_later_lines_enter_on_their_cue():
    director = Director.from_plan(parse_plan(encoded(plan()), SIZE), SIZE)
    hook, second = (40, 40, 440, 130), (40, 170, 440, 260)
    assert ink(drawn(director, 0.0), hook) > 500
    assert ink(drawn(director, 0.0), second) == 0
    assert ink(drawn(director, 0.59), second) == 0
    assert ink(drawn(director, 1.2), second) > 300


def test_the_wiggle_moves_its_word_and_returns_it_to_rest():
    director = Director.from_plan(parse_plan(encoded(plan()), SIZE), SIZE)
    rest = drawn(director, 2.5)
    assert ImageChops.difference(drawn(director, 1.42), rest).getbbox() is not None
    assert ImageChops.difference(drawn(director, 1.85), rest).getbbox() is None


def test_the_logo_is_drawn_when_the_plan_asks_for_one():
    director = Director.from_plan(parse_plan(encoded(plan(brand="lockup")), SIZE), SIZE)
    plain = Director.from_plan(parse_plan(encoded(plan()), SIZE), SIZE)
    assert director.logo is not None and director.logo.width == 270
    zone = ((480 - 270) // 2, 60, (480 + 270) // 2, 60 + director.logo.height)
    assert ink(drawn(director, 0.0), zone) > ink(drawn(plain, 0.0), zone) + 300
