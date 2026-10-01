import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { uploadCheckResultSchema } from "@/lib/contract";
import { countTextLines, evaluateUploadChecks, generationSize, runUploadChecks } from "@/lib/upload-checks";
import { alphaPng, background, cleanText, pottyLikeText, whiteText } from "./fixtures/layers/synthetic";

const codes = (result: { items: Array<{ code: string }> }) => result.items.map((item) => item.code);

const alphaOf = async (png: Buffer) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = data[index * 4 + 3];
  return { alpha, width: info.width, height: info.height };
};

describe("upload checks", () => {
  it("warns about see-through letters and haze on a potty-like pair, and sizes it 768×960", async () => {
    const result = await runUploadChecks(await background(1122, 1402), await pottyLikeText());
    expect(uploadCheckResultSchema.safeParse(result).success).toBe(true);
    expect(result.ok).toBe(true);
    expect(codes(result)).toEqual(["text_not_solid", "text_haze"]);
    expect(result.textLayer).toMatchObject({ lines: 14 });
    expect(result.textLayer!.partialPercent).toBeGreaterThan(5);
    expect(result.textLayer!.hazePercent).toBeGreaterThan(1);
    expect(result.generationSize).toEqual({ width: 768, height: 960 });
  });

  it("rejects a text layer exported on white", async () => {
    const result = await runUploadChecks(await background(1080, 1350), await whiteText(1080, 1350));
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["no_alpha"]);
    const opaque = await runUploadChecks(await background(64, 80), await alphaPng(64, 80, () => 255));
    expect(codes(opaque)).toEqual(["no_alpha"]);
  });

  it("rejects mismatched sizes", async () => {
    const result = await runUploadChecks(await background(1122, 1402), await cleanText(1080, 1350, 5));
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["size_mismatch"]);
    expect(result.items[0].message).toContain("1080×1350");
  });

  it("sizes 9:16 and 1:1 slides in multiples of 64 within 10% of the target", async () => {
    const tall = await runUploadChecks(await background(1080, 1920), await cleanText(1080, 1920, 5));
    const square = await runUploadChecks(await background(1080, 1080), await cleanText(1080, 1080, 3));
    expect([tall.ok, square.ok]).toEqual([true, true]);
    expect(tall.generationSize).toEqual({ width: 640, height: 1152 });
    expect(square.generationSize).toEqual({ width: 832, height: 832 });
    for (const size of [tall.generationSize!, square.generationSize!]) {
      expect(size.width % 64 + size.height % 64).toBe(0);
      expect(Math.abs(size.width * size.height - 768 * 960) / (768 * 960)).toBeLessThan(0.1);
    }
    expect(square.textLayer!.lines).toBe(3);
  });

  it("rejects slides outside 9:16 to 16:9 and files over the limits", () => {
    const panorama = evaluateUploadChecks({ width: 2400, height: 1000, byteSize: 1000 }, null);
    expect(codes(panorama)).toEqual(["ratio_unsupported"]);
    expect(panorama.generationSize).toBeUndefined();
    const heavy = evaluateUploadChecks({ width: 1080, height: 1350, byteSize: 30 * 1024 * 1024 }, null);
    expect(codes(heavy)).toEqual(["too_large"]);
  });

  it("allows a background without a text layer", async () => {
    const result = await runUploadChecks(await background(1122, 1402), null);
    expect(result).toEqual({ ok: true, items: [], generationSize: { width: 768, height: 960 } });
  });

  it("matches the benchmark's generation sizes", () => {
    expect(generationSize(1122, 1402)).toEqual({ width: 768, height: 960 });
    expect(generationSize(1129, 1393)).toEqual({ width: 768, height: 960 });
  });
});

describe("line splitting (same rule as P4)", () => {
  it("keeps an icon with its word on one line", async () => {
    const png = await alphaPng(400, 200, (x, y) => {
      const word = y >= 60 && y < 90 && x >= 80 && x < 300;
      const icon = (x - 50) ** 2 + (y - 75) ** 2 <= 22 ** 2;
      const second = y >= 130 && y < 160 && x >= 80 && x < 300;
      return word || icon || second ? 255 : 0;
    });
    const { alpha, width, height } = await alphaOf(png);
    expect(countTextLines(alpha, width, height)).toBe(2);
  });

  it("does not merge two lines joined by a lone descender", async () => {
    const png = await alphaPng(400, 200, (x, y) => {
      const first = y >= 40 && y < 70 && x >= 40 && x < 360;
      const descender = x >= 100 && x < 104 && y >= 70 && y < 110;
      const second = y >= 110 && y < 140 && x >= 40 && x < 360;
      return first || descender || second ? 255 : 0;
    });
    const { alpha, width, height } = await alphaOf(png);
    expect(countTextLines(alpha, width, height)).toBe(2);
  });

  it("ignores haze when counting lines", async () => {
    const png = await alphaPng(300, 120, (x, y) => (y >= 20 && y < 40 && x < 200 ? 255 : 6));
    const { alpha, width, height } = await alphaOf(png);
    expect(countTextLines(alpha, width, height)).toBe(1);
  });
});

const pottyDir = new URL("../../benchmarks/gpu/slides-private/", import.meta.url);
describe.skipIf(!existsSync(new URL("potty-text.png", pottyDir)))("the real potty pair (local only)", () => {
  it("warns about see-through letters and haze, finds 14 lines and sizes it 768×960", async () => {
    const result = await runUploadChecks(
      readFileSync(new URL("potty-background.webp", pottyDir)),
      readFileSync(new URL("potty-text.png", pottyDir)),
    );
    expect(codes(result)).toEqual(["text_not_solid", "text_haze"]);
    expect(result.textLayer!.lines).toBe(14);
    expect(result.generationSize).toEqual({ width: 768, height: 960 });
  });
});
