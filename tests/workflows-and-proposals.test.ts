import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "@/lib/store";
import { executeWorkflowRun } from "@/lib/workflows";
import { approveProposalJobs } from "@/lib/proposals";

describe("workflows and approved proposals", () => {
  const stores: ReturnType<typeof createStore>[] = [];
  const storeFor = () => { const store = createStore(":memory:"); stores.push(store); return store; };
  afterEach(() => stores.splice(0).forEach((store) => store.close()));

  it("creates a generation checkpoint once and resumes it after a second execution", () => {
    const store = storeFor(); const project = store.createProject("Carousel");
    const workflow = store.createWorkflow("One shot", { nodes: [{ id: "shot", type: "generate-video", data: { modelId: "alibaba:wan2.7-i2v", prompt: "Move", inputAssetIds: [], inputRoles: [] } }], edges: [] });
    const run = store.createWorkflowRun(workflow.id, project.id, JSON.parse(workflow.graph));
    const first = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));
    const second = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));
    expect(first.createdJobs).toHaveLength(1); expect(second.createdJobs).toHaveLength(0); expect(store.listJobs(project.id)).toHaveLength(1);
  });

  it("turns an approved Director proposal into exactly its reviewed jobs once", () => {
    const store = storeFor(); const project = store.createProject("Director project");
    const proposal = store.createProposal(project.id, "Make two shots", { shots: [{ prompt: "First", modelId: "alibaba:wan2.7-i2v", duration: 5, resolution: "720P", inputAssetIds: [], inputRoles: [] }, { prompt: "Second", modelId: "alibaba:wan2.7-i2v", duration: 5, resolution: "720P", inputAssetIds: [], inputRoles: [] }] });
    const first = approveProposalJobs(store, proposal.id, new Set(["alibaba:wan2.7-i2v"]));
    expect(first).toHaveLength(2); expect(() => approveProposalJobs(store, proposal.id, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/already approved/i);
  });
});
