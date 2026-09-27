import { describe, expect, it } from "vitest";

describe("Bailian CLI preflight", () => {
  it("records only safe CLI metadata after the documented non-generation checks succeed", async () => {
    const requested: string[][] = [];
    const responses = [
      { stdout: "Bailian CLI 1.4.2\n", stderr: "" },
      { stdout: "Usage: bl file upload --file PATH --model MODEL\n", stderr: "" },
      { stdout: "Authenticated profile: studio-singapore\n", stderr: "" },
    ];
    const { preflightBailianCli } = await import("@/lib/media-transport/bailian-cli-preflight");

    const result = await preflightBailianCli({
      execute: async (_executable, args) => {
        requested.push(args);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected CLI command.");
        return response;
      },
    });

    expect(result).toEqual({ cliVersion: "1.4.2", uploadHelpAvailable: true, authenticated: true });
    expect(requested).toEqual([["--version"], ["file", "upload", "--help"], ["auth", "status"]]);
    expect(JSON.stringify(result)).not.toContain("studio-singapore");
  });

  it("does not surface CLI output when a documented preflight check fails", async () => {
    const { preflightBailianCli } = await import("@/lib/media-transport/bailian-cli-preflight");

    await expect(preflightBailianCli({
      execute: async () => { throw new Error("profile token=owner-only-value"); },
    })).rejects.toThrow("Bailian CLI preflight failed. Verify the official CLI installation and authenticated Singapore profile before retrying.");
  });
});
