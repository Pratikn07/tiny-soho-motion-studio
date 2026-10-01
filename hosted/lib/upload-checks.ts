import sharp from "sharp";

import type { UploadCheckResult } from "@/lib/contract";

// Same constants as creative-vision/src/finish.py (P4), so the counted lines match the finished video.
const SOLID = 230;
const CLEAR = 12;
const INK = 40;
const THIN_ROW = 0.03;
const MIN_GAP = 2;

const NOT_SOLID_LIMIT = 0.05;
const HAZE_LIMIT = 0.01;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MIN_RATIO = 9 / 16;
const MAX_RATIO = 16 / 9;
const TARGET_PIXELS = 768 * 960;

export type LayerInfo = { width: number; height: number; byteSize: number };
/** The text layer's alpha channel, row by row; null when the file has no alpha channel. */
export type TextLayerPixels = LayerInfo & { alpha: Uint8Array | null };

const round = (value: number) => Math.round(value * 10) / 10;

/** About 768×960 pixels' worth at the slide's ratio, each side rounded to a multiple of 64 (LTX). */
export function generationSize(width: number, height: number) {
  const scale = Math.sqrt(TARGET_PIXELS / (width * height));
  const side = (value: number) => Math.max(256, Math.round((value * scale) / 64) * 64);
  return { width: side(width), height: side(height) };
}

/** Lines of text after clean-up: horizontal bands separated by thin rows, each gap cut at its thinnest row. */
export function countTextLines(alpha: Uint8Array, width: number, height: number) {
  const counts = new Array<number>(height).fill(0);
  const anyInk = new Array<boolean>(height).fill(false);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const raw = alpha[y * width + x];
      const cleaned = raw >= SOLID ? 255 : raw <= CLEAR ? 0 : raw;
      if (cleaned > INK) counts[y] += 1;
      if (cleaned > 0) anyInk[y] = true;
    }
  }
  const runs: Array<[number, number]> = [];
  let start: number | null = null;
  for (let y = 0; y <= height; y += 1) {
    const busy = y < height && counts[y] > THIN_ROW * width;
    if (busy && start === null) start = y;
    else if (!busy && start !== null) {
      runs.push([start, y]);
      start = null;
    }
  }
  const cuts = [0];
  for (let index = 1; index < runs.length; index += 1) {
    const gapStart = runs[index - 1][1];
    const gapEnd = runs[index][0];
    if (gapEnd - gapStart < MIN_GAP) continue;
    let thinnest = gapStart;
    for (let y = gapStart; y < gapEnd; y += 1) if (counts[y] < counts[thinnest]) thinnest = y;
    cuts.push(thinnest);
  }
  cuts.push(height);
  let lines = 0;
  for (let index = 1; index < cuts.length; index += 1) {
    if (anyInk.slice(cuts[index - 1], cuts[index]).some(Boolean)) lines += 1;
  }
  return lines;
}

export function textLayerStats(alpha: Uint8Array, width: number, height: number) {
  let haze = 0;
  let letters = 0;
  let solid = 0;
  let partial = 0;
  for (const value of alpha) {
    if (value === 0) continue;
    if (value <= CLEAR) haze += 1;
    else {
      letters += 1;
      if (value === 255) solid += 1;
      else if (value > SOLID) partial += 1;
    }
  }
  return {
    solidPercent: letters ? round((solid / letters) * 100) : 0,
    partialPercent: letters ? round((partial / letters) * 100) : 0,
    hazePercent: round((haze / alpha.length) * 100),
    lines: countTextLines(alpha, width, height),
    notSolid: letters > 0 && partial / letters > NOT_SOLID_LIMIT,
    hazy: haze / alpha.length > HAZE_LIMIT,
    opaque: letters === alpha.length && solid === letters,
  };
}

/** The upload checks (B2) for a slide's background and optional text layer, over already decoded pixels. */
export function evaluateUploadChecks(background: LayerInfo, text: TextLayerPixels | null): UploadCheckResult {
  const items: UploadCheckResult["items"] = [];
  const size = `${background.width}×${background.height}`;
  for (const [layer, info] of [["background", background], ["text layer", text]] as const) {
    if (info && (info.byteSize > MAX_BYTES || info.width * info.height > MAX_PIXELS)) {
      items.push({ code: "too_large", severity: "error", message: `The ${layer} is too large. Use at most 25 MB and 40 megapixels.` });
    }
  }
  const ratio = background.width / background.height;
  const ratioOk = ratio >= MIN_RATIO - 1e-9 && ratio <= MAX_RATIO + 1e-9;
  if (!ratioOk) {
    items.push({
      code: "ratio_unsupported",
      severity: "error",
      message: `This slide is ${size}. Slides from 9:16 (tall) to 16:9 (wide) are supported.`,
    });
  }

  let textLayer: UploadCheckResult["textLayer"];
  if (text) {
    if (text.width !== background.width || text.height !== background.height) {
      items.push({
        code: "size_mismatch",
        severity: "error",
        message: `The text layer is ${text.width}×${text.height} but the background is ${size}. Export both at the same size.`,
      });
    }
    const stats = text.alpha ? textLayerStats(text.alpha, text.width, text.height) : null;
    if (!stats || stats.opaque) {
      items.push({
        code: "no_alpha",
        severity: "error",
        message: "The text layer has no transparent background. Export it as a PNG with transparency.",
      });
    } else {
      const { notSolid, hazy, opaque: _opaque, ...shown } = stats;
      textLayer = shown;
      if (notSolid) {
        items.push({ code: "text_not_solid", severity: "warning", message: "Letters look slightly see-through; they will be made solid." });
      }
      if (hazy) {
        items.push({ code: "text_haze", severity: "warning", message: "A faint haze around the text will be removed." });
      }
    }
  }

  return {
    ok: !items.some((item) => item.severity === "error"),
    items,
    ...(textLayer ? { textLayer } : {}),
    ...(ratioOk ? { generationSize: generationSize(background.width, background.height) } : {}),
  };
}

/** Decodes both files with sharp (orientation applied, as in validation) and runs the checks. */
export async function runUploadChecks(background: Buffer, text: Buffer | null): Promise<UploadCheckResult> {
  const backgroundInfo = (await sharp(background, { limitInputPixels: MAX_PIXELS }).rotate().toBuffer({ resolveWithObject: true })).info;
  let textPixels: TextLayerPixels | null = null;
  if (text) {
    const image = sharp(text, { limitInputPixels: MAX_PIXELS }).rotate();
    const hasAlpha = (await image.clone().metadata()).hasAlpha;
    const decoded = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;
    let alpha: Uint8Array | null = null;
    if (hasAlpha) {
      alpha = new Uint8Array(width * height);
      for (let index = 0; index < alpha.length; index += 1) alpha[index] = decoded.data[index * channels + channels - 1];
    }
    textPixels = { width, height, byteSize: text.byteLength, alpha };
  }
  return evaluateUploadChecks(
    { width: backgroundInfo.width, height: backgroundInfo.height, byteSize: background.byteLength },
    textPixels,
  );
}
