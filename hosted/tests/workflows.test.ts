import { describe, expect, it } from "vitest";

import { validateWorkflowGraph } from "@/lib/workflows";

describe("hosted Workflow Studio", () => {
  it("rejects a cycle before saving a hosted workflow", () => {
    expect(() => validateWorkflowGraph({
      version: 2,
      nodes: [
        { id: "first", type: "asset", data: { assetId: "11111111-1111-4111-8111-111111111111" } },
        { id: "second", type: "noop", data: {} },
      ],
      edges: [
        { source: "first", sourceOutput: "asset", target: "second", targetInput: "asset" },
        { source: "second", sourceOutput: "output", target: "first", targetInput: "asset" },
      ],
    }, [])).toThrow(/cycle/i);
  });
});
