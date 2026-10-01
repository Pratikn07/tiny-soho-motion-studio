// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreationShell } from "@/components/creation/CreationShell";
import { createMockCreationApi } from "@/components/creation/mock-api";
import { mockModels } from "@/components/creation/model/mock-routes";
import { mockReview } from "@/components/creation/motion/mock-routes";

const file = (name: string) => new File([new Uint8Array(8)], name, { type: name.endsWith(".png") ? "image/png" : "image/jpeg" });

async function open(names = ["potty"]) {
  const api = createMockCreationApi({ measure: async () => ({ width: 1122, height: 1402 }), objectUrl: () => "blob:u" });
  render(<CreationShell api={api} />);
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: names.flatMap((name) => [file(`${name}-background.jpg`), file(`${name}-text.png`)]) },
  });
  const motion = await screen.findByRole("region", { name: "Motion" }, { timeout: 3000 });
  const model = screen.getByRole("region", { name: "Video model" });
  const pick = async () => {
    const group = await within(screen.getByRole("region", { name: "Motion" })).findByRole("radiogroup", { name: "Suggested motions" }, { timeout: 3000 });
    fireEvent.click(within(group).getAllByRole("radio")[0]);
  };
  const savedDocument = async () => {
    await screen.findByText("Saved", {}, { timeout: 3000 });
    return (await api.getCreation(new URL(window.location.href).searchParams.get("creation")!)).document;
  };
  return { api, motion, model, pick, savedDocument };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/?studio=creation");
  URL.createObjectURL = vi.fn(() => "blob:local");
  URL.revokeObjectURL = vi.fn();
  Object.assign(mockReview, { failReview: false, failIdea: false, calls: 0 });
  Object.assign(mockModels, { acknowledged: new Set(), reservedUsd: 0, runs: [], fit: {} });
});
afterEach(() => cleanup());

describe("model panel", () => {
  it("picks LTX, confirms billing once, shows the cost and starts a run for the slide", async () => {
    const { model, pick, savedDocument } = await open();
    const models = await within(model).findByRole("radiogroup", { name: "Video model" });
    expect(within(models).getByRole("radio", { name: /Recommended/ })).toBeChecked();
    expect(models).toHaveTextContent("about $0.03 a clip");
    expect(models).toHaveTextContent("about $0.50 a clip");
    const generate = within(model).getByRole("button", { name: "Generate this slide" });
    expect(generate).toBeDisabled();
    expect(model).toHaveTextContent("Pick a motion first.");

    await pick();
    await within(model).findByRole("region", { name: "Before the first video from Modal" });
    expect(generate).toBeDisabled();
    fireEvent.click(within(model).getByRole("button", { name: "I understand, continue" }));
    await waitFor(() => expect(within(model).queryByRole("region", { name: /Before the first video/ })).not.toBeInTheDocument());
    expect(mockModels.acknowledged.has("modal-ltx")).toBe(true);
    expect(model).toHaveTextContent("About $0.06 for 2 takes · 0.1% of this month's budget");
    expect(model).toHaveTextContent("$43.54 of $50 left this month");

    fireEvent.click(generate);
    expect(await within(model).findByText(/Generating\./)).toBeInTheDocument();
    expect(mockModels.runs).toHaveLength(1);
    const [{ request, run }] = mockModels.runs;
    expect(request).toMatchObject({ modelId: "ltx-2.5-distilled", seeds: 2, motion: { source: "suggestion", suggestionIndex: 0, motionStyle: "calm" } });
    expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect((await savedDocument()).slides[0].latestRunId).toBe(run.id); // U3 follows the run from here.
    await waitFor(() => expect(model).toHaveTextContent("$43.48 of $50 left this month"));
  });

  it("greys out a model that can't take the slide, with the reason", async () => {
    mockModels.fit = { "wan3-i2v": { ok: false, reason: "Cannot hold the last frame in place, so the child may walk into your text." } };
    const { model } = await open();
    const models = await within(model).findByRole("radiogroup", { name: "Video model" });
    const wan3 = within(models).getByRole("radio", { name: /Wan 3/ });
    expect(wan3).toBeDisabled();
    expect(models).toHaveTextContent("Cannot hold the last frame in place");
    expect(within(models).getByRole("radio", { name: /Wan 2\.7/ })).toBeEnabled();
  });

  it("sets the model for every slide, or overrides it for one slide", async () => {
    const { model, pick, savedDocument } = await open();
    await pick();
    const models = await within(model).findByRole("radiogroup", { name: "Video model" });
    fireEvent.click(within(model).getByRole("checkbox", { name: "Use a different model for this slide" }));
    fireEvent.click(within(models).getByRole("radio", { name: /Wan 2\.7/ }));
    let doc = await savedDocument();
    expect(doc.slides[0].modelId).toBe("wan2.7-i2v");
    expect(doc.defaults.modelId).toBe("ltx-2.5-distilled");
    expect(model).toHaveTextContent("About $1.00 for 2 takes");
    fireEvent.click(within(model).getByRole("checkbox", { name: "Use a different model for this slide" }));
    doc = await savedDocument();
    expect(doc.slides[0].modelId).toBeUndefined();
  });

  it("totals the cost for all ready slides and starts each one", async () => {
    mockModels.acknowledged.add("modal-ltx");
    const { model, pick } = await open(["potty", "meal"]);
    await pick();
    fireEvent.click(screen.getByRole("button", { name: /^Slide 2:/ }));
    await pick();
    const all = await within(screen.getByRole("region", { name: "Video model" })).findByRole("button", { name: "Generate all slides (2 · about $0.12)" });
    fireEvent.click(all);
    expect(await screen.findByText("Generating 2 slides.")).toBeInTheDocument();
    expect(mockModels.runs.map((entry) => entry.request.modelId)).toEqual(["ltx-2.5-distilled", "ltx-2.5-distilled"]);
    expect(new Set(mockModels.runs.map((entry) => entry.slideId)).size).toBe(2);
    expect(model).toBeTruthy();
  });

  it("won't start a take that would go over this month's budget", async () => {
    mockModels.acknowledged.add("modal-ltx");
    mockModels.reservedUsd = 43.5; // $0.04 left; a slide costs about $0.06.
    const { model, pick } = await open();
    await pick();
    await within(model).findByText("This would go over this month's budget ($0.04 left).");
    expect(within(model).getByRole("button", { name: "Generate this slide" })).toBeDisabled();
    expect(mockModels.runs).toHaveLength(0);
  });
});
