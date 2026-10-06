"""The motion director's text animation, replayed over the model clip.

The Claude Code motion director (Pratikn07/tiny-soho-motion-runtime) writes a `plan.json` for each slide: every
line's words, brand type role, size and position, plus timed entrance and accent cues per word. Its `tools/render.py`
uses that plan to make the director's preview and `text-layer.png`. This module is a Pillow-only port of the same
layout, timing and effects, so finishing can play the director's motion over the LTX clip instead of the plain line
reveal. Keep the maths in step with render.py (effects, easing, layout); the brand fonts and logos in
`creative-vision/brand/` are copies of the runtime's.

The plan comes from a model run on a creator's slide, so it is validated strictly before use and never trusted for
file paths, sizes or loop counts.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

BRAND = Path(__file__).resolve().parents[1] / "brand"
FONTS = BRAND / "fonts"
LOGOS = {"wordmark": BRAND / "logo" / "tiny-soho-wordmark.png", "lockup": BRAND / "logo" / "tiny-soho-lockup.png"}
LOGO_WIDTH, LOGO_TOP = 270, 60
COCOA, ROSE = (50, 23, 8), (185, 94, 86)

# Brand type roles: file, variation axes, tracking (em), all caps. Source Serif 4 axes are [wght, opsz]; DM Sans
# axes are [opsz, wght].
ROLES = {
    "display": ("InstrumentSerif-Regular.ttf", None, 0.0, True),
    "headline": ("SourceSerif4[opsz,wght].ttf", [600, 36], -0.005, False),
    "heading": ("SourceSerif4[opsz,wght].ttf", [700, 48], -0.01, False),
    "body": ("SourceSerif4[opsz,wght].ttf", [450, 16], 0.0, False),
    "eyebrow": ("SourceSerif4[opsz,wght].ttf", [600, 20], 0.3, True),
    "label": ("DMSans[opsz,wght].ttf", [14, 600], 0.14, True),
}
ENTRANCES = {"none", "fade", "rise", "snap", "slow", "spring", "stamp", "pop", "slide-left", "slide-right", "drop"}
ACCENTS = {"droop", "pulse", "nudge", "wiggle", "hop", "tilt"}
PAD = 26  # Room around each word's sprite for rotation, scale and blur.

# Plan limits. A real plan has under 12 lines and 30 cues; anything far outside is not a plan we should render.
MAX_PLAN_BYTES = 200_000
MAX_LINES, MAX_RUNS, MAX_WORDS, MAX_CUES = 40, 30, 300, 200
MAX_TEXT, MAX_ID = 300, 40
SIZE_RANGE = (4.0, 600.0)
AT_LIMIT, DUR_LIMIT, STAGGER_LIMIT, AMOUNT_LIMIT = 30.0, 10.0, 2.0, 300.0


# --- easing (render.py) -----------------------------------------------------------------------------------------

def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def out_quart(t: float) -> float:
    return 1 - (1 - clamp01(t)) ** 4


def out_cubic(t: float) -> float:
    return 1 - (1 - clamp01(t)) ** 3


def in_cubic(t: float) -> float:
    return clamp01(t) ** 3


def out_bounce(t: float) -> float:
    """Falls and bounces twice, settling at 1."""
    t = clamp01(t)
    if t < 0.55:
        return (t / 0.55) ** 2
    if t < 0.82:
        u = (t - 0.685) / 0.135
        return 1 - 0.12 * (1 - u * u)
    u = (t - 0.91) / 0.09
    return 1 - 0.035 * (1 - min(1.0, u * u))


def out_back(t: float, s: float = 2.2) -> float:
    t = clamp01(t) - 1
    return 1 + (s + 1) * t ** 3 + s * t ** 2


# --- plan validation --------------------------------------------------------------------------------------------

def _number(value: object, name: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not low <= value <= high:
        raise ValueError(f"The motion plan's {name} is out of range.")
    return float(value)


def _text(value: object, name: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"The motion plan's {name} is not valid text.")
    return value


def parse_plan(data: bytes, size: tuple[int, int]) -> dict:
    """The parts of a director plan that finishing uses, checked. Raises ValueError for anything else."""
    if len(data) > MAX_PLAN_BYTES:
        raise ValueError("The motion plan is too large.")
    try:
        raw = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("The motion plan is not valid JSON.") from None
    if not isinstance(raw, dict):
        raise ValueError("The motion plan must be an object.")
    width, height = size
    lines_in = raw.get("lines")
    if not isinstance(lines_in, list) or not 1 <= len(lines_in) <= MAX_LINES:
        raise ValueError("The motion plan has no lines, or too many.")
    lines, ids, words = [], set(), 0
    for item in lines_in:
        if not isinstance(item, dict):
            raise ValueError("Each motion plan line must be an object.")
        line_id = _text(item.get("id"), "line id", MAX_ID)
        if line_id in ids:
            raise ValueError("The motion plan repeats a line id.")
        ids.add(line_id)
        role = item.get("role", "body")
        if role not in ROLES:
            raise ValueError("The motion plan uses an unknown type role.")
        box = item.get("box")
        if not isinstance(box, list) or len(box) != 4:
            raise ValueError("Each motion plan line needs a box.")
        x0, y0 = _number(box[0], "box", -width, 2 * width), _number(box[1], "box", -height, 2 * height)
        x1, y1 = _number(box[2], "box", -width, 2 * width), _number(box[3], "box", -height, 2 * height)
        if x1 <= x0 or y1 <= y0:
            raise ValueError("A motion plan box is empty.")
        runs_in = item.get("runs")
        if not isinstance(runs_in, list) or not 1 <= len(runs_in) <= MAX_RUNS:
            raise ValueError("Each motion plan line needs its text runs.")
        runs = []
        for run in runs_in:
            if not isinstance(run, dict) or not isinstance(run.get("rose", False), bool):
                raise ValueError("A motion plan text run is not valid.")
            text = _text(run.get("text"), "text", MAX_TEXT)
            words += len(text.split())
            runs.append({"text": text, "rose": bool(run.get("rose", False))})
        line = {"id": line_id, "role": role, "box": [x0, y0, x1, y1], "runs": runs}
        if item.get("size") is not None:
            line["size"] = _number(item["size"], "size", *SIZE_RANGE)
        if "x" in item:
            line["x"] = _number(item["x"], "x", -width, 2 * width)
        if "y" in item:
            line["y"] = _number(item["y"], "y", -height, 2 * height)
        align = item.get("align", "left")
        if align not in ("left", "center", "right"):
            raise ValueError("The motion plan uses an unknown alignment.")
        line["align"] = align
        lines.append(line)
    if words > MAX_WORDS:
        raise ValueError("The motion plan has too many words.")
    cues_in = raw.get("motion", [])
    if not isinstance(cues_in, list) or len(cues_in) > MAX_CUES:
        raise ValueError("The motion plan has too many cues.")
    cues = []
    for item in cues_in:
        if not isinstance(item, dict) or item.get("line") not in ids:
            raise ValueError("A motion cue points at a line that is not in the plan.")
        effect = item.get("effect")
        if effect not in ENTRANCES and effect not in ACCENTS:
            raise ValueError("A motion cue uses an unknown effect.")
        cue: dict = {"line": item["line"], "effect": effect, "at": _number(item.get("at", 0), "cue time", 0, AT_LIMIT),
                     "stagger": _number(item.get("stagger", 0), "stagger", 0, STAGGER_LIMIT)}
        default = 0.55 if effect in ACCENTS else 0.45
        cue["dur"] = _number(item.get("dur", default), "duration", 0, DUR_LIMIT)
        if item.get("amount") is not None:
            cue["amount"] = _number(item["amount"], "amount", -AMOUNT_LIMIT, AMOUNT_LIMIT)
        span = item.get("words", "all")
        if span != "all":
            if not isinstance(span, list) or len(span) != 2 \
                    or not all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= MAX_WORDS for v in span):
                raise ValueError("A motion cue's word range is not valid.")
            cue["words"] = list(span)
        cues.append(cue)
    brand = raw.get("brand", True)
    if brand not in (True, False, "wordmark", "lockup"):
        raise ValueError("The motion plan's logo choice is not valid.")
    return {"lines": lines, "motion": cues, "brand": brand}


# --- layout (render.py) -----------------------------------------------------------------------------------------

@lru_cache(maxsize=256)
def font(role: str, size: float) -> ImageFont.FreeTypeFont:
    file, axes, _, _ = ROLES[role]
    loaded = ImageFont.truetype(str(FONTS / file), max(1, round(size)))
    if axes:
        loaded.set_variation_by_axes(axes)
    return loaded


def ink_box(text: str, role: str, size: float) -> tuple[float, float, float, float]:
    f = font(role, size)
    track = ROLES[role][2] * size
    if not track:
        return f.getbbox(text, anchor="ls")
    x, top, bottom, right = 0.0, 0, 0, 0.0
    for ch in text:
        b = f.getbbox(ch, anchor="ls")
        top, bottom, right = min(top, b[1]), max(bottom, b[3]), max(right, x + b[2])
        x += f.getlength(ch) + track
    return (0, top, right, bottom)


def advance(text: str, role: str, size: float) -> float:
    f = font(role, size)
    track = ROLES[role][2] * size
    return f.getlength(text) + track * max(0, len(text) - 1) if track else f.getlength(text)


def line_words(line: dict) -> list[dict]:
    caps = ROLES[line["role"]][3]
    return [{"text": w.upper() if caps else w, "rose": run["rose"]} for run in line["runs"] for w in run["text"].split()]


def layout(plan: dict) -> list[dict]:
    """Place every word: size fits the original lettering height unless the plan sets `size`; the line keeps its
    original left edge (or centre/right with `align`) and vertical centre unless the plan sets `x`/`y`."""
    placed = []
    for li, line in enumerate(plan["lines"]):
        role = line["role"]
        words = line_words(line)
        text = " ".join(w["text"] for w in words)
        x0, y0, x1, y1 = line["box"]
        if "size" in line:
            size = line["size"]
        else:
            b = ink_box(text, role, 200)
            size = 200 * (y1 - y0) / max(1, b[3] - b[1])
            width = advance(text, role, size)
            if width > (x1 - x0) * 1.06:
                size *= (x1 - x0) * 1.06 / width
            size = min(max(size, SIZE_RANGE[0]), SIZE_RANGE[1])
        f = font(role, size)
        track = ROLES[role][2] * size

        def prefix_width(chunk: str) -> float:
            # Measured the way the whole line is typeset, so word gaps and kerning match one-piece setting.
            if not track:
                return f.getlength(chunk)
            return sum(f.getlength(ch) + track for ch in chunk)

        total = prefix_width(text) - (track if track else 0)
        if "x" in line:
            x = line["x"]
        elif line["align"] == "center":
            x = (x0 + x1) / 2 - total / 2
        elif line["align"] == "right":
            x = x1 - total
        else:
            x = x0
        b = ink_box(text, role, size)
        baseline = line["y"] if "y" in line else (y0 + y1) / 2 - (b[1] + b[3]) / 2
        pos = 0
        for wi, w in enumerate(words):
            start = text.index(w["text"], pos)
            pos = start + len(w["text"])
            placed.append({"line": line["id"], "wi": wi, "text": w["text"], "rose": w["rose"], "role": role,
                           "size": size, "x": x + prefix_width(text[:start]), "baseline": baseline})
    return placed


def sprite(word: dict) -> tuple[Image.Image, tuple[float, float]]:
    f = font(word["role"], word["size"])
    color = ROSE if word["rose"] else COCOA
    track = ROLES[word["role"]][2] * word["size"]
    b = ink_box(word["text"], word["role"], word["size"])
    w, h = int(b[2] - b[0]) + PAD * 2, int(b[3] - b[1]) + PAD * 2
    image = Image.new("RGBA", (w, h), color + (0,))
    draw = ImageDraw.Draw(image)
    ox, oy = PAD - b[0], PAD - b[1]
    if track:
        x = ox
        for ch in word["text"]:
            draw.text((x, oy), ch, font=f, fill=color + (255,), anchor="ls")
            x += f.getlength(ch) + track
    else:
        draw.text((ox, oy), word["text"], font=f, fill=color + (255,), anchor="ls")
    return image, (ox, oy)


# --- timing (render.py) -----------------------------------------------------------------------------------------

def schedule(plan: dict, placed: list[dict]) -> None:
    """Attach entrance and accent cues to words. Unlisted words are on screen from 0."""
    for w in placed:
        w["enter"] = {"effect": "none", "at": 0.0, "dur": 0.0}
        w["accents"] = []
    by_line: dict[str, list[dict]] = {}
    for w in placed:
        by_line.setdefault(w["line"], []).append(w)
    for cue in plan["motion"]:
        ws = by_line.get(cue["line"], [])
        if "words" in cue:
            a, b = cue["words"]
            ws = ws[a:b]
        for k, w in enumerate(ws):
            timing = {"effect": cue["effect"], "at": cue["at"] + k * cue["stagger"], "dur": cue["dur"],
                      "amount": cue.get("amount")}
            if cue["effect"] in ENTRANCES:
                w["enter"] = timing
            else:
                w["accents"].append(timing)


def enter_state(e: dict, t: float) -> tuple[float, float, float, float, float, float] | None:
    """(alpha, dx, dy, scale, rot, blur) for an entrance, or None before it starts."""
    if e["effect"] == "none":
        return 1.0, 0, 0, 1, 0, 0
    p = (t - e["at"]) / max(1e-6, e["dur"])
    if p <= 0:
        return None
    k = out_quart(p)
    amt = e.get("amount")
    effect = e["effect"]
    if effect == "fade":
        return k, 0, 0, 1, 0, 0
    if effect == "rise":
        return k, 0, (amt or 22) * (1 - k), 1, 0, 3.0 * max(0, 1 - p / 0.6)
    if effect == "slow":
        return k, 0, (amt or 16) * (1 - k), 1, 0, 4.0 * max(0, 1 - p / 0.7)
    if effect == "snap":
        return out_cubic(p * 1.4), 0, (amt or 30) * (1 - k), 1, 0, 0
    if effect == "spring":
        s = 0.55 + 0.45 * out_back(p)
        return clamp01(p * 2.5), 0, (amt or 34) * (1 - out_back(p)), s, 0, 0
    if effect == "stamp":
        q = clamp01(p / 0.3)
        s = (amt or 1.35) - ((amt or 1.35) - 1) * in_cubic(q) if q < 1 else 1.0
        return clamp01(p * 5), 0, 0, s, -6 * (1 - in_cubic(q)), 0
    if effect == "pop":
        return clamp01(p * 3), 0, 0, 0.9 + 0.1 * out_back(p, 1.4), 0, 0
    if effect == "drop":
        return clamp01(p * 4), 0, -(amt or 60) * (1 - out_bounce(p)), 1, 0, 0
    sign = -1 if effect == "slide-left" else 1  # slide-left / slide-right
    return k, sign * (amt or 28) * (1 - k), 0, 1, 0, 3.0 * max(0, 1 - p / 0.6)


def accent_offset(w: dict, t: float) -> tuple[float, float, float, float]:
    """Extra (dx, dy, scale, rot) from accents such as the droop."""
    dx = dy = rot = 0.0
    scale = 1.0
    for a in w["accents"]:
        p = (t - a["at"]) / max(1e-6, a["dur"])
        if p <= 0:
            continue
        amt = a.get("amount") or 1.0
        effect = a["effect"]
        if effect == "droop":
            q = min(p, 1.0)
            k = 1 - math.cos(q * math.pi * 1.5) * math.exp(-q * 4) if q < 1 else 1.0
            lean = (7 + 4 * (w["wi"] % 2)) * amt
            dx += 3 * k
            dy += (9 + 6 * (w["wi"] % 2)) * amt * k
            rot -= lean * k
        elif effect == "pulse" and p < 1:
            scale *= 1 + 0.14 * amt * math.sin(math.pi * p)
        elif effect == "nudge" and p < 1:
            dx += 10 * amt * math.sin(math.pi * p) * math.exp(-p * 2)
        elif effect == "wiggle" and p < 1:
            shake = math.sin(p * 4 * math.pi) * (1 - p)
            rot += 11 * amt * shake
            dx += 4 * amt * shake
        elif effect == "hop" and p < 1:
            dy -= 16 * amt * math.sin(math.pi * p)
        elif effect == "tilt":
            rot += 6 * amt * out_back(min(p, 1.0), 1.6)
    return dx, dy, scale, rot


def cue_end(timing: dict) -> float:
    return timing["at"] + timing["dur"]


# --- rendering --------------------------------------------------------------------------------------------------

def _paste(canvas: Image.Image, piece: Image.Image, x: int, y: int) -> None:
    """alpha_composite that tolerates pieces hanging off the top or left edge."""
    if x < 0 or y < 0:
        piece = piece.crop((max(0, -x), max(0, -y), piece.width, piece.height))
        x, y = max(0, x), max(0, y)
    if x < canvas.width and y < canvas.height and piece.width and piece.height:
        canvas.alpha_composite(piece, dest=(x, y))


@dataclass
class Director:
    """A parsed plan, laid out and ready to draw at any time t (seconds)."""
    words: list[dict]
    logo: Image.Image | None
    size: tuple[int, int]
    lines: int
    text_in_by: float  # Every entrance has finished.
    settled_at: float  # Every entrance and accent has finished; from here the text layer is shown exactly.

    @classmethod
    def from_plan(cls, plan: dict, size: tuple[int, int]) -> "Director":
        words = layout(plan)
        schedule(plan, words)
        for word in words:
            word["sprite"] = sprite(word)
        logo = None
        if plan["brand"]:
            with Image.open(LOGOS["lockup" if plan["brand"] == "lockup" else "wordmark"]) as image:
                mark = image.convert("RGBA")
            mark = mark.crop(mark.getchannel("A").getbbox())
            logo = mark.resize((LOGO_WIDTH, round(mark.height * LOGO_WIDTH / mark.width)), Image.LANCZOS)
        entrances = [cue_end(w["enter"]) for w in words if w["enter"]["effect"] != "none"]
        accents = [cue_end(a) for w in words for a in w["accents"]]
        text_in_by = round(max(entrances, default=0.0), 2)
        return cls(words, logo, size, len(plan["lines"]), text_in_by, max([text_in_by, *accents]))

    def draw(self, canvas: Image.Image, t: float) -> None:
        """Draws the text (and logo) as it stands at time t onto an RGBA canvas."""
        for word in self.words:
            self._draw_word(canvas, word, t)
        if self.logo is not None:
            _paste(canvas, self.logo, (self.size[0] - self.logo.width) // 2, LOGO_TOP)

    @staticmethod
    def _draw_word(canvas: Image.Image, word: dict, t: float) -> None:
        state = enter_state(word["enter"], t)
        if state is None:
            return
        alpha, dx, dy, scale, rot, blur = state
        adx, ady, ascale, arot = accent_offset(word, t)
        dx, dy, scale, rot = dx + adx, dy + ady, scale * ascale, rot + arot
        image, (ox, oy) = word["sprite"]
        fx, fy = word["x"] - ox + dx, word["baseline"] - oy + dy
        ix, iy = math.floor(fx), math.floor(fy)
        sx, sy = fx - ix, fy - iy
        if scale != 1 or rot != 0 or sx > 1e-3 or sy > 1e-3:
            # The same forward matrix as cv2.getRotationMatrix2D about the sprite centre plus the sub-pixel shift,
            # inverted because Pillow maps output pixels back to input pixels.
            w, h = image.size
            cx, cy = w / 2, h / 2
            a, b = scale * math.cos(math.radians(rot)), scale * math.sin(math.radians(rot))
            tx, ty = (1 - a) * cx - b * cy + sx, b * cx + (1 - a) * cy + sy
            det = a * a + b * b
            ia, ib, ic, id_ = a / det, -b / det, b / det, a / det
            image = image.transform((w, h), Image.AFFINE, (ia, ib, -(ia * tx + ib * ty), ic, id_, -(ic * tx + id_ * ty)),
                                    resample=Image.BICUBIC)
        if blur > 0.05:
            image = image.filter(ImageFilter.GaussianBlur(blur))
        if alpha < 1:
            image = image.copy()
            image.putalpha(image.getchannel("A").point(lambda v: round(v * alpha)))
        _paste(canvas, image, ix, iy)
