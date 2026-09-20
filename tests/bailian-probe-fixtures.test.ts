import { describe, expect, it } from "vitest";
import { bailianProbeFixtures } from "@/lib/media-transport/probe-fixtures";

describe("Bailian no-generation probe fixtures", () => {
  it("defines a small MP4 and WAV fixture for validating URL-required media transport", () => {
    const fixtures = bailianProbeFixtures("/owner-only/probe");

    expect(fixtures.map((fixture) => ({ name: fixture.asset.name, mime: fixture.asset.mime, width: fixture.asset.width, height: fixture.asset.height, duration: fixture.asset.duration }))).toEqual([
      { name: "probe.mp4", mime: "video/mp4", width: 320, height: 320, duration: 1 },
      { name: "probe.wav", mime: "audio/wav", width: null, height: null, duration: 1 },
    ]);
    expect(fixtures.every((fixture) => fixture.command[0] === "-y")).toBe(true);
    expect(fixtures[0].command).toContain("color=c=black:s=320x320:r=24");
    expect(fixtures[1].command).toContain("anullsrc=r=16000:cl=mono");
  });
});
