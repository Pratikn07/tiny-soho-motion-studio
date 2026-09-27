---
name: Tiny Soho Studio
description: A light editorial workspace for shaping finished image carousels into short, reviewable stories.
colors:
  ink: "#242622"
  muted: "#6e7069"
  line: "#e2e2d9"
  paper: "#f5f5ef"
  surface: "#fdfdf9"
  white: "#ffffff"
  sage: "#486452"
  sage-deep: "#272e25"
  sage-wash: "#edf2e9"
  warm-alert: "#a14c2d"
  warm-note: "#f4f1e7"
typography:
  display:
    fontFamily: "StudioDidot, Georgia, serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.14
    letterSpacing: "-0.7px"
  headline:
    fontFamily: "StudioDidot, Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.6px"
  title:
    fontFamily: "StudioDidot, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.2
  body:
    fontFamily: "Avenir Next, Avenir, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Avenir Next, Avenir, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "3px"
  md: "4px"
  lg: "6px"
  pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
  section: "28px"
components:
  button-primary:
    backgroundColor: "{colors.sage-deep}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.sage-deep}"
    rounded: "{rounded.md}"
    padding: "10px"
    height: "42px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "4px"
    size: "30px"
  story-choice:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "45px"
  text-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  slide-thumb:
    backgroundColor: "#f1eee7"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "137px"
  nav-current:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    padding: "0 2px"
    height: "78px"
  movement-region:
    backgroundColor: "{colors.sage-wash}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
---

# Design System: Tiny Soho Studio

## Overview

**Creative North Star: "The Editorial Worktable"**

Tiny Soho Studio treats the creator's finished artwork as the primary material on a quiet, premium worktable. Ivory and white surfaces, near-black controls, fine rules, generous space, and restrained serif display lettering make room for the image to lead. Working controls use plain creator language and a calm system sans so that the interface feels considered without becoming precious.

The desktop workspace is an ordered rail, uncropped source stage, and focused inspector. The rail and inspector provide structure around the artwork; the inspector can scroll while the primary action remains reserved at the bottom. At the 740px breakpoint, the rail becomes a horizontal strip and the inspector follows the image. Source ratio is preserved at every viewport, including the sample preview and movement overlay.

**Key Characteristics:**

- Light editorial surfaces with near-black ink and restrained sage state.
- GFS Didot display voice paired with Avenir Next/system sans controls.
- Thin dividers, compact four-pixel corners, and quiet tonal depth.
- Artwork leads; samples, movement regions, and review states remain explicit.

## Colors

The palette is warm, nearly monochrome, and low saturation. Sage is reserved for active, safe, and editable states; warm clay is reserved for overlap or error recovery.

### Primary

- **Worktable Sage** (`#486452`): Active movement controls, toggles, links, and safe state indicators.

### Neutral

- **Near-Black Ink** (`#242622`): Main text, controls, selected navigation, and primary contrast.
- **Quiet Muted** (`#6e7069`): Supporting labels, metadata, and secondary guidance.
- **Fine Rule** (`#e2e2d9`): Dividers between rails, stages, sections, and footer boundaries.
- **Ivory Paper** (`#f5f5ef`): Canvas mat behind the source image.
- **Editorial Surface** (`#fdfdf9`): Application and inspector surface.
- **White** (`#ffffff`): Top bar, text fields, selected view, and light control interiors.
- **Sage Deep** (`#272e25`): Primary action and selected thumbnail number.
- **Sage Wash** (`#edf2e9`): Success/message surface and selected story choice.
- **Warm Review** (`#f4f1e7`): Known sample-review note surface.
- **Warm Clay** (`#a14c2d`): Movement overlap warning and actionable error state.

### Named Rules

**The Rare Sage Rule.** Use sage as a state signal for active, safe, or editable controls; keep the majority of every screen ivory, white, or ink.

## Typography

**Display Font:** StudioDidot (GFS Didot asset) with Georgia, serif fallback
**Body Font:** Avenir Next with Avenir and system sans fallbacks
**Label/Mono Font:** System sans labels with tabular numerals for time and dimensions

**Character:** Didot gives project names and inspector headings an editorial, composed voice. The sans stays small, direct, and operational for controls, metadata, and recovery copy.

### Hierarchy

- **Display** (400, 34px, 1.14): Inspector title and modal headings.
- **Headline** (400, 30px, 1.2): Project title and prominent workspace naming.
- **Title** (400, 17px, 1.2): Preview and supporting editorial subheads.
- **Body** (400, 13px, 1.5): Application base copy and readable guidance.
- **Label** (500, 11px, 1.4): Tabs, field labels, story choices, and working controls.

### Named Rules

**The Two Voices Rule.** Reserve Didot for naming and hierarchy; use the sans for every action, state, measurement, and explanation.

## Layout

Desktop uses a fixed-height editor below the 78px top bar, project bar, and any message strip. The main workspace is a three-column grid: a 176px ordered slide rail, a flexible image canvas with a 350px minimum, and a 344px inspector. The 1600px layout widens these to 200px / flexible / 380px; at 1150px and 900px the rail and inspector contract while preserving the image's minimum.

The artwork is centered on an ivory canvas mat and uses `object-fit: contain`; its width derives from the source ratio and available viewport, capped at 500px on desktop. The inspector body scrolls independently while its footer and primary action remain visible. At 740px and below, the workspace stacks: project navigation remains first, the rail becomes a horizontal 80px thumbnail strip, the image canvas follows, and the inspector becomes a full-width section below it. Mobile controls use larger touch targets and retain the same source ratio.

Spacing is built from compact 4/8/12/18/24/28px steps, with 34px desktop page insets and 18–22px mobile insets. Fine one-pixel rules provide separation instead of heavy panels.

## Elevation & Depth

The system is mostly flat and tonal. Fine rules and small background shifts establish structure; shadows are reserved for the artwork stage, selected view, dialog, and interactive movement handle. Do not turn every card or section into a floating surface.

### Shadow Vocabulary

- **Artwork lift** (`0 12px 30px #33332212, 0 2px 6px #3333220b`): Quietly separates the source image from the paper mat.
- **Selected view** (`0 1px 3px #272f2310`): Slightly raises the active original/video switch.
- **Dialog depth** (`0 24px 80px #21251e33`): Reserves the strongest depth for modal library/help surfaces.

### Named Rules

**The Flat Worktable Rule.** Start surfaces flat; use a restrained shadow only where an image, dialog, or active control needs physical separation.

## Shapes

The form language is gently squared and editorial: most controls use a 4px radius, modal and view-switch containers use 6px, and status toggles or avatars use circular geometry. Borders are thin and low contrast. Artwork is never clipped or forced into a fixed ratio; thumbnails use `object-fit: contain` inside a warm image well. The movement region uses a 1.5px sage border, a translucent sage wash, and a small labelled handle.

## Components

### Buttons

Buttons are quiet working tools with explicit state. Primary actions are filled deep sage with white text and a 4px corner; secondary actions are outlined and sage-toned; icon buttons are 30px square and become a soft gray-green on hover. Every focusable control receives a visible 2px sage outline with 4px offset. Disabled buttons retain their geometry and become 40% opaque.

### Cards / Containers

Story choices, message strips, review notes, and image wells use tonal surfaces and one-pixel borders rather than floating cards. Story choices are 45px minimum with a 4px radius; the selected choice gets a sage wash and stronger border. The source artwork stage is the signature container: it is centered, ratio-preserving, and lightly lifted above the paper canvas.

### Inputs / Fields

The project title is an unboxed Didot input with a subtle underline on hover. Story text uses a white 4px-radius textarea, one-pixel neutral border, 12px internal padding, and a sage border on focus. Range controls use sage accents and preserve the bounded movement region's values.

### Navigation

The top bar is 78px desktop / 63px mobile, with a Didot wordmark, a plain sans navigation row, and a thin bottom rule. The current route is identified by near-black text and a 2px ink underline. On mobile, secondary nav items hide while the current route, preview badge, and compact actions remain.

### Slide Rail

The ordered rail uses 137px desktop thumbnails and 80px × 92px mobile thumbnails. Images stay uncropped and labels identify the slide and origin. The selected thumbnail receives a dark green border and a soft outer keyline; the add control is a dashed sage-gray rectangle. At mobile the rail scrolls horizontally and upload guidance moves out of the way.

### Movement Region

The editable region is a bounded overlay on the uncropped source. It has a sage border and wash in a valid state, a clay border and tag when it overlaps protected artwork, and a small 23px resize handle. The overlay can be hidden for a clean review, but its state is always recoverable through the inspector.

## Do's and Don'ts

### Do:

- **Do** let the supplied artwork lead the workspace and preserve its exact source ratio.
- **Do** use Didot for project and inspector naming, and Avenir Next/system sans for operations.
- **Do** use fine rules, warm whites, and restrained sage to clarify state.
- **Do** keep sample labels, review notes, focus rings, and recovery copy visible and truthful.
- **Do** honor the 740px stack and reduced-motion preference; preserve keyboard focus visibility.

### Don't:

- **Don't** crop, stretch, or replace original artwork with a fabricated preview.
- **Don't** introduce dark application chrome, saturated accents, gradients, or decorative glass effects.
- **Don't** imply provider progress, AI analysis, or generation success for the local sample UI.
- **Don't** hide the primary action behind an inspector scroll or make mobile a shrunken desktop grid.
- **Don't** use motion that persists when `prefers-reduced-motion: reduce` is active.
