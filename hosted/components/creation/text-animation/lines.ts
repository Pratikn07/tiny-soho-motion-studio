import type { TextAnimation } from "@/lib/contract";
export type Box = [number, number, number, number];
export function splitTextLines(data: ArrayLike<number>, width: number, height: number): { boxes: Box[]; pixels: Uint8ClampedArray } {
  const pixels = new Uint8ClampedArray(data);
  const counts = new Uint32Array(height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4 + 3;
    pixels[i] = pixels[i] >= 230 ? 255 : pixels[i] <= 12 ? 0 : pixels[i];
    if (pixels[i] > 40) counts[y]++;
  }
  const runs: Array<[number, number]> = [];
  let start: number | null = null;
  for (let y = 0; y <= height; y++) {
    if (y < height && counts[y] > 0.03 * width) { if (start === null) start = y; }
    else if (start !== null) { runs.push([start, y]); start = null; }
  }
  const cuts = [0];
  for (let i = 1; i < runs.length; i++) {
    const end = runs[i - 1][1], next = runs[i][0];
    if (next - end < 2) continue;
    let cut = end;
    for (let y = end + 1; y < next; y++) if (counts[y] < counts[cut]) cut = y;
    cuts.push(cut);
  }
  cuts.push(height);
  const boxes: Box[] = [];
  for (let band = 1; band < cuts.length; band++) {
    let left = width, top = height, right = 0, bottom = 0;
    for (let y = cuts[band - 1]; y < cuts[band]; y++) for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = y + 1;
    }
    if (right > left) boxes.push([left, top, right, bottom]);
  }
  return { boxes, pixels };
}
export function scheduleText(animation: TextAnimation, count: number) {
  if (animation.style === "none" || count === 0) return { starts: Array(count).fill(0) as number[], fade: 0, rise: 0, textInBy: 0, step: 0 };
  const fade = Math.max(animation.fade, 1 / 24);
  let step = animation.step;
  if (count > 1 && animation.firstAt + step * (count - 1) + fade > 4.5) step = Math.max(0, (4.5 - animation.firstAt - fade) / (count - 1));
  const first = Math.min(animation.firstAt, Math.max(0, 4.5 - fade));
  const starts = Array.from({ length: count }, (_, i) => Math.round((first + step * i) * 10000) / 10000);
  return { starts, fade, rise: animation.style === "fade-rise" ? animation.rise : 0,
    textInBy: Math.round((starts[count - 1] + fade) * 100) / 100, step: Math.round(step * 10000) / 10000 };
}
