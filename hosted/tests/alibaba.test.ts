import { describe, expect, it, vi } from "vitest";
import { checkWanTask, submitWanJob } from "@/lib/alibaba";

describe("hosted Wan provider payload", () => {
  it("maps start and end media to first_frame and last_frame", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: { task_id: "task-1" } }), { status: 200 }),
    );

    await submitWanJob(
      { modelId: "wan2.7-i2v", prompt: "Move", options: { duration: 5, resolution: "720P" } },
      [
        { role: "start-image", mimeType: "image/png", bytes: Buffer.from("start") },
        { role: "end-image", mimeType: "image/png", bytes: Buffer.from("end") },
      ],
      { apiKey: "test", workspaceId: "workspace", fetcher },
    );

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.input.media.map((entry: { type: string }) => entry.type)).toEqual(["first_frame", "last_frame"]);
    expect(fetcher.mock.calls[0][1]?.headers["X-DashScope-Async"]).toBe("enable");
  });

  it("maps a provider terminal response to a safe status and output URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: { task_status: "SUCCEEDED", video_url: "https://provider.test/result.mp4" } }), { status: 200 }),
    );

    await expect(checkWanTask("task-1", { apiKey: "test", workspaceId: "workspace", fetcher }))
      .resolves.toEqual({ status: "SUCCEEDED", outputUrl: "https://provider.test/result.mp4" });
  });
});
