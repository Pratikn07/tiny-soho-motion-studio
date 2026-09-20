import path from "node:path";
import type { Asset } from "../store";

type ProbeAsset = Pick<Asset, "name" | "mime" | "path" | "width" | "height" | "duration">;

export type BailianProbeFixture = { asset: ProbeAsset; command: string[] };

/**
 * Synthetic URL-required media only. These commands create no user media and
 * are intentionally consumed only by the explicit, no-generation CLI probe.
 */
export function bailianProbeFixtures(directory: string): BailianProbeFixture[] {
  const videoPath = path.join(directory, "probe.mp4");
  const audioPath = path.join(directory, "probe.wav");
  return [
    {
      asset: { name: "probe.mp4", mime: "video/mp4", path: videoPath, width: 320, height: 320, duration: 1 },
      command: ["-y", "-f", "lavfi", "-i", "color=c=black:s=320x320:r=24", "-t", "1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath],
    },
    {
      asset: { name: "probe.wav", mime: "audio/wav", path: audioPath, width: null, height: null, duration: 1 },
      command: ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", "-c:a", "pcm_s16le", audioPath],
    },
  ];
}
