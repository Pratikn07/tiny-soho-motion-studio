import sharp from "sharp";

/** RGBA pixels with a given alpha function, encoded as PNG. */
export async function alphaPng(width: number, height: number, alphaAt: (x: number, y: number) => number) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = 92;
      data[index + 1] = 64;
      data[index + 2] = 44;
      data[index + 3] = alphaAt(x, y);
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export const background = (width: number, height: number) => sharp({
  create: { width, height, channels: 3, background: { r: 236, g: 226, b: 210 } },
}).jpeg().toBuffer();

/**
 * Like the first real layered slide (potty, 1122×1402): 14 lines of text in a left column, about 10% of the letter
 * pixels at 240 alpha instead of 255, and a faint alpha-5 haze over about 2% of the image.
 */
export function pottyLikeText() {
  const width = 1122;
  const height = 1402;
  const top = 60;
  const lineHeight = 44;
  const pitch = 92;
  return alphaPng(width, height, (x, y) => {
    const row = Math.floor((y - top) / pitch);
    const inLine = y >= top && row < 14 && (y - top) % pitch < lineHeight && x >= 56 && x < 56 + 520 - row * 12;
    if (inLine) return (x + y) % 10 === 0 ? 240 : 255;
    const underLine = y >= top && row < 14 && (y - top) % pitch < lineHeight + 6 && x >= 40 && x < 640;
    return underLine ? 5 : 0;
  });
}

/** A text layer exported on white: no alpha channel at all. */
export const whiteText = (width: number, height: number) => sharp({
  create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
}).png().toBuffer();

/** Clean, solid lines of text (no warnings). */
export const cleanText = (width: number, height: number, lines: number) => alphaPng(width, height, (x, y) => {
  const pitch = Math.floor(height / (lines + 1));
  return y % pitch > pitch / 2 && Math.floor(y / pitch) < lines && x > width * 0.1 && x < width * 0.6 ? 255 : 0;
});
