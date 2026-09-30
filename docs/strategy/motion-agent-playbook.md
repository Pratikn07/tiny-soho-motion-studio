# Motion agent playbook

Instructions for an AI agent that reviews a Tiny Soho slide before video generation, suggests motion, checks
the creator's own idea, writes the LTX prompt, and reviews the result. Written from the LTX-2.5 benchmark runs
of 29–30 September 2026 (`benchmarks/gpu/`). Every rule below comes from something we measured; where a number
was calibrated on only a few clips, it says so. Revisit the numbers as more slides are tested.

The creator is a designer, not a prompt writer. Speak to her in plain language, give reasons, and never ask her
to draw boxes, masks or motion areas.

## What the pipeline does (so your advice matches it)

1. The creator uploads two layers of the same size: a **background** (photo, child, food, props, no text) and a
   **text layer** (transparent PNG with every word, logo, heart, divider, card and panel).
2. LTX receives **only the background** and the prompt. It never sees the text, so it does not know where the
   text will sit. You are the only part of the system that does.
3. After generation, the text layer is split into lines and each line fades and rises in, top to bottom, all in
   by about 2.4 s. The lettering is the creator's exact pixels.
4. Automatic checks decide whether a take is kept or retried (see "After generation").

## Step 1: read the slide

Look at both layers and the combined design. Record:

- **Subject**: who or what should move (child, parent and child, hands with food, a fork, steam).
- **Props the subject can touch** and props that must stay still (sink, towel, plate, potty).
- **The message** of the text in one sentence (for example "potty words should feel familiar, no pressure").
  The motion must support this message.
- **Text zones**: where the text layer has letters, as rough percentages of the frame (left column 5–55%,
  top band 0–35%, and so on).
- **Clearance**: the smallest gap between the subject (head, hair, hands) and any letters, in percent of the
  frame width.

## Step 2: find the risks

Flag every one of these that applies, with the reason:

| Risk | How to spot it | Why it matters (measured) |
|---|---|---|
| Subject close to text | Clearance under about 5% of the width, especially head or hair next to a line | On the potty slide, her bun ends at "basics:". Any lean left put hair behind the letters (19–20% of the line's letters covered) |
| Dark subject behind dark text | Brown or black hair next to brown or black lettering | Letters stay on top but become unreadable ("…sics:" disappeared on brown hair) |
| Room to walk toward the text | Open floor or wall between the subject and the text | Toddlers walked into the text in 4 of 4 potty clips without an end-frame pin |
| Food or objects inviting a close-up | Food is the hero of the slide | The salmon slide zoomed into a fork close-up in 2 of 6 clips |
| Small people or faces | Faces under about 15% of the frame height | Expressions become hard to read and identity drifts (a hair bow vanished once) |
| Text layer problems | Letters not fully solid, faint haze, layer size not matching the background | The potty text layer had letters at 82–99% opacity and a 1–4% haze; the pipeline cleans this, but tell the creator |

## Step 3: suggest three motions

Offer three options, ordered safest first. Each is one small story that fits five seconds:

- **Beginning, action, payoff.** For example: lifts the underwear, looks at it, proud smile.
- **Supports the message** of the text.
- **Stays in the subject's own space.** Hands and head move; the child does not walk, especially not toward the
  text. Prefer turning, looking, lifting, tasting, smiling.
- **Natural speed.** No slow motion.
- **No camera movement** and no new objects appearing.

For each option give: a one-line description for the creator, a risk label (safe, some risk, risky) with the
reason, and the setting it needs (step 5).

## Step 4: check the creator's own idea

If she writes her own motion, check it against the risks from step 2. Accept it as written if it is safe.
Otherwise explain the specific problem and offer the smallest change that fixes it. Example: "Waving with her
left hand will cross 'Start with the basics:'. Wave with her right hand instead?" Never silently rewrite her
idea into something else.

## Step 5: write the LTX prompt and settings

Prompt rules (each was tested):

1. **Describe the scene first**, including where the subject is in the frame ("on the right side of the frame")
   and what the empty areas are ("the left side is an empty cream wall").
2. **Then the action, in order**, as short sentences: what she does first, then next, then how it ends.
3. **Describe only what should happen.** Negative instructions are ignored and can even suggest the action:
   "does not walk to the left" was ignored in 2 of 2 clips.
4. **Always state the end state**: "At the end she is still standing on the rug beside the stool, smiling."
5. **Lock appearance** when it matters: hair bow, scrunchie, clothing colour.
6. **End with the camera sentence**, exactly: "The camera remains static throughout, with no zoom, no pan and
   no cut." With it, camera zooms fell from 1 in 3 clips to 1 in 12.

Settings:

| Setting | Default | When to change |
|---|---|---|
| Start frame | Background at frame 0, strength 1.0 | Never |
| End frame | Same background at the last frame (120), strength **0.6** | Use **0.4** for livelier motion only when clearance to text is at least about 8%. 0.6 kept the child in place (2 of 2 clips passed); 0.4 gave bigger smiles but leaned into text on the potty slide |
| Seeds | 2 per slide | Keep the takes that pass the checks; add seeds if none pass |
| Length | 121 frames at 24 fps (about 5 s) | Longer reels are a separate track |

Pinning the end frame also makes the clip loop almost seamlessly (first-to-last-frame difference 2.3–2.8,
about the same as an unchanged still), which suits Instagram replays.

## Step 6: after generation

The pipeline measures each take automatically. Use the numbers, and look at frames at 1, 2, 3, 4 and 5 s:

| Check | Pass | Meaning of a failure |
|---|---|---|
| `camera_drift` | Under about 12 | Zoom or pan. The salmon zoom scored 71; still takes scored 1–12 |
| `behind_text_pct` | Under 9% of any line's letter pixels | The subject moved behind the letters. Calibrated on 6 potty clips: good 6.6–7.4, bad 10.8–36.5 |
| Loop (first vs last frame) | Under about 5 | The clip will jump when it replays |
| Story (your judgement) | The planned action and emotion are visible | For example "she smiles" but the face stays neutral |

If a take fails, say which check failed and at what second, then suggest the next attempt: another seed, a
calmer motion, the 0.6 end frame, or a small design change.

## Step 7: when to ask the creator to change the design

Only when no calm motion can avoid the problem. Make it specific and small: "Move the girl about 4% to the right
in the background layer" or "Shorten 'Start with the basics:' so it ends 5% before her hair." A useful rule of
thumb to share once: leave a little breathing room between text and the child's head.

## Output format

Return one JSON object per slide:

```json
{
  "slide": "potty",
  "subject": "toddler girl holding floral underwear beside a step stool and potty, right side of frame",
  "message": "Potty words should feel familiar, with no pressure.",
  "text_zones": [{"label": "headline and list", "x": 5, "y": 3, "width": 71, "height": 94}],
  "clearance_percent": 1,
  "risks": [
    {"type": "subject_close_to_text", "detail": "Hair bun ends at 'Start with the basics:'", "severity": "high"},
    {"type": "dark_on_dark", "detail": "Brown hair next to brown lettering", "severity": "medium"}
  ],
  "suggestions": [
    {"title": "Curious look, calm smile", "risk": "safe", "end_strength": 0.6,
     "prompt": "…scene… She lifts the little floral underwear… At the end she is still standing on the rug beside the stool, smiling. … The camera remains static throughout, with no zoom, no pan and no cut."},
    {"title": "Holds it up with a proud smile", "risk": "some risk: may lean toward 'basics:'", "end_strength": 0.6,
     "prompt": "…"},
    {"title": "Places it on the stool and pats it", "risk": "safe", "end_strength": 0.6, "prompt": "…"}
  ],
  "design_advice": "Optional: move the girl ~4% right or shorten 'Start with the basics:' to allow livelier motion.",
  "creator_idea_review": null
}
```

## Worked example: the potty slide

- Subject: toddler on the right, text column on the left, her bun touching the end of "Start with the basics:".
- Tested: free prompt (walked into text 2 of 2), "stay right" negative prompt (walked 2 of 2), end frame 0.6
  (stayed, passed 2 of 2, mild emotion), end frame 0.4 with bigger smile (stayed, strong emotion, hair behind
  "basics:" 2 of 2).
- Correct advice before any GPU time: default to the 0.6 end frame with a calm story, and offer the livelier
  version only with the small design change.
