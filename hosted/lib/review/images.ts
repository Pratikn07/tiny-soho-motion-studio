import sharp from "sharp";

import type { ReviewImage } from "./prompt";

const MAX_SIDE = 1600;
const LIMIT_PIXELS = 40_000_000;
const NEUTRAL_GREY = { r: 128, g: 128, b: 128, alpha: 1 };

const jpeg = async (input: Buffer, label: string): Promise<ReviewImage> => ({
  label,
  mimeType: "image/jpeg",
  base64: (await sharp(input)
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: NEUTRAL_GREY })
    .jpeg({ quality: 90 })
    .toBuffer()).toString("base64"),
});

/**
 * The reviewer's views, each re-encoded to at most 1600 px: the background, the text layer on neutral grey (so
 * light and dark letters both show), and the flattened design. Without a text layer, only the slide itself.
 */
export async function reviewImages(background: Buffer, text: Buffer | null): Promise<ReviewImage[]> {
  const oriented = await sharp(background, { limitInputPixels: LIMIT_PIXELS }).rotate().png().toBuffer({ resolveWithObject: true });
  if (!text) return [await jpeg(oriented.data, "slide")];
  const { width, height } = oriented.info;
  const layer = await sharp(text, { limitInputPixels: LIMIT_PIXELS }).resize(width, height, { fit: "fill" }).png().toBuffer();
  const onGrey = await sharp({ create: { width, height, channels: 4, background: NEUTRAL_GREY } })
    .composite([{ input: layer }]).png().toBuffer();
  const flattened = await sharp(oriented.data).composite([{ input: layer }]).png().toBuffer();
  return [
    await jpeg(oriented.data, "background"),
    await jpeg(onGrey, "text layer"),
    await jpeg(flattened, "finished design"),
  ];
}
