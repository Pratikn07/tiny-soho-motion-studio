<!-- Snapshot of ~/Documents/working/mch/tiny-soho-reels/STYLE.md (local-only repo) taken 7 Oct 2026, for agents without access to that folder. The local file is the source of truth. -->

# Tiny Soho reels: style sheet

One film language for every reel on @tinysoho. Scenes live in `app/src/scenes/`, shared helpers in
`app/src/scenes/_brand.ts`.

## Frame
- 1080 x 1920 (9:16), 30 fps export, motion blur on fast moves.
- Safe area for anything that must be read: x 90–990, y 220–1500. Instagram covers the bottom ~420 px
  (caption, buttons) and the right ~90 px (like/comment rail).
- Frame 0 is the cover: the hook line, the character and the Tiny Soho lockup are all readable on it.
  Nothing that matters fades in.

## Colour
| Role | Hex | Use |
|---|---|---|
| Cocoa ink | `#321708` | Text on light paper |
| Cocoa card | `#2A150B` | Dark scene paper |
| Cream paper | `#F4EADC` | Light scene paper, text on dark paper |
| Rose | `#B0544C` | The one emphasis word, light paper |
| Rose light | `#E8A39A` | The one emphasis word, dark paper |
| Gold | `#F3C46B` | Subtitles and small labels on dark paper |
| Night | `#1F2340` / `#161A33` | Night scenes |
| Sage | `#3F5A47` | Reveal scenes |
| Pumpkin | `#E8833A` | Illustrations only, never type |

One paper colour per scene. Scene changes are object transitions (below), not plain cuts.

## Type
| Role | Face | Size (px) | Notes |
|---|---|---|---|
| Headline | Fraunces Display 480 | 120–170 | Sentence case, tracking −2 %, lines tight (0.95) |
| Emphasis word | Fraunces Display Italic 420 | same as headline | Rose; at most one per line |
| Subtitle | Fraunces Text Italic 500 | 44–48 | Gold on dark, rose on light; burned in, word by word |
| Label | Inter 800 | 28–34 | Spaced capitals (+16 %), for tags like MASKS, 7:42 PM |

## Images and stickers
- Higgsfield only where code cannot do it well: the cast (Anaika, Bhagyashree) and print-style objects.
  Everything else is drawn in code.
- Every cut-out gets a 12 px warm-white edge and a soft drop shadow (30 px blur, 16 px down).
- Stickers and characters move **on twos** (12 fps steps) for a handmade collage feel; the camera,
  paper, light and type move at the full 30 fps.

## Motion
- One idea per scene, one signature move per scene. Everything else stays quiet.
- Moves land on the spoken word (word timings from `data/lyrics.json`), with a 0.2–0.4 s beat before
  the signature move.
- Easing: `outBack` for pops, `outCubic` for slides, springs for stamps. Never linear.
- Overlap: elements start a few frames apart, never all on one frame.
- Effects menu (shared with tiny-soho-motion-runtime): rise, snap, spring, stamp, pop, drop; accents
  droop, pulse, nudge, wiggle, hop, tilt.

## Transitions (reel 01)
Hook → Myth: an orange candy flies to centre and becomes the giant spotlit candy.
Myth → Study: push into the MYTH stamp's paper. Study → Cup: the meter needle swings to the cup.
Cup → Question: the peeling label flips the frame. Question → Reveal: iris on Anaika's eyes into night.
Reveal → Payoff: the clock face becomes the moon. Payoff → End: the blanket fold wipes to cream.

## Finish
Film grain 0.035, vignette 0.25–0.3, bloom very low (threshold 1.4), no HUD.
Sound: voice on top; music bed ducked under the voice; one sound per on-screen action; master −14 LUFS.

## Tone
Calm, realistic motherhood. No shaming of kids, parents or food. Claims are checked; uncertain ones say
"probably".
