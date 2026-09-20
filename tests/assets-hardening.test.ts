import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { adoptProviderDownload, downloadProviderAsset, extensionForMime, isAllowedProviderResultUrl } from "@/lib/assets";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const publicResolver = async () => [{ address: "8.8.8.8" }];
const responseWith = (bytes: Buffer) => async () => ({ statusCode: 200, contentType: "image/png", body: Readable.from([bytes]) });

describe("provider result persistence", () => {
  const directories: string[] = [];
  const previousDataDir = process.env.TINY_SOHO_DATA_DIR;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (previousDataDir === undefined) delete process.env.TINY_SOHO_DATA_DIR;
    else process.env.TINY_SOHO_DATA_DIR = previousDataDir;
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("allows only exact Alibaba storage domain boundaries", () => {
    expect(isAllowedProviderResultUrl("https://studio-result.oss-ap-southeast-1.aliyuncs.com/video.mp4")).toBe(true);
    expect(isAllowedProviderResultUrl("https://cdn.alicdn.com/output.mp4")).toBe(true);
    expect(isAllowedProviderResultUrl("https://evilaliyuncs.com/output.mp4")).toBe(false);
    expect(isAllowedProviderResultUrl("https://aliyuncs.com.evil.example/output.mp4")).toBe(false);
    expect(isAllowedProviderResultUrl("https://user@cdn.alicdn.com/output.mp4")).toBe(false);
    expect(isAllowedProviderResultUrl("https://cdn.alicdn.com:8443/output.mp4")).toBe(false);
    expect(isAllowedProviderResultUrl("http://cdn.alicdn.com/output.mp4")).toBe(false);
  });

  it("streams a validated provider response to a temporary file without provider credentials", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tiny-soho-provider-result-"));
    directories.push(directory);
    process.env.TINY_SOHO_DATA_DIR = directory;
    const downloaded = await downloadProviderAsset("https://studio-result.oss-ap-southeast-1.aliyuncs.com/result.png", { resolveAddresses: publicResolver, requestResponse: responseWith(ONE_PIXEL_PNG) });
    const saved = await adoptProviderDownload(downloaded);

    expect(await readFile(saved.path)).toEqual(ONE_PIXEL_PNG);
    expect(saved.width).toBe(1);
    expect(saved.height).toBe(1);
  });

  it("rejects a streamed response once its configured hard ceiling is exceeded", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tiny-soho-provider-result-"));
    directories.push(directory);
    process.env.TINY_SOHO_DATA_DIR = directory;
    await expect(downloadProviderAsset("https://studio-result.oss-ap-southeast-1.aliyuncs.com/result.png", { maximumBytes: 32, resolveAddresses: publicResolver, requestResponse: responseWith(ONE_PIXEL_PNG) })).rejects.toThrow(/exceeds/i);
  });

  it("rejects a provider host that resolves to a private address", async () => {
    const requestResponse = vi.fn(responseWith(ONE_PIXEL_PNG));
    await expect(downloadProviderAsset("https://studio-result.oss-ap-southeast-1.aliyuncs.com/result.png", { resolveAddresses: async () => [{ address: "127.0.0.1" }], requestResponse })).rejects.toThrow(/unsafe network/i);
    expect(requestResponse).not.toHaveBeenCalled();
  });

  it("destroys an unacceptable provider response before returning an error", async () => {
    const abort = vi.fn();
    await expect(downloadProviderAsset("https://studio-result.oss-ap-southeast-1.aliyuncs.com/result.png", {
      resolveAddresses: publicResolver,
      requestResponse: async () => ({ statusCode: 302, contentType: "image/png", body: Readable.from([ONE_PIXEL_PNG]), abort }),
    })).rejects.toThrow(/redirects/i);
    expect(abort).toHaveBeenCalledOnce();
  });

  it("uses a real MP4 extension rather than a generic binary extension", () => {
    expect(extensionForMime("video/mp4")).toBe("mp4");
  });
});
