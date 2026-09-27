import { describe, expect, it } from "vitest";
import {
  acknowledgementKey,
  hasAcknowledgement,
} from "@/lib/model-acknowledgements";

describe("model acknowledgement", () => {
  it("does not accept an acknowledgement from an older contract", () => {
    const current = acknowledgementKey("wan2.7-t2v", "2026-09-20");
    expect(hasAcknowledgement([
      { model_id: "wan2.7-t2v", contract_version: "2026-09-20" },
    ], current)).toBe(true);
    expect(hasAcknowledgement([
      { model_id: "wan2.7-t2v", contract_version: "2026-09-19" },
    ], current)).toBe(false);
  });
});
