import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "@/lib/store";
import { executeWorkflowRun } from "@/lib/workflows";
import { approveProposalJobs } from "@/lib/proposals";

describe("workflows and approved proposals", () => {
  const stores: ReturnType<typeof createStore>[] = [];
  const storeFor = () => { const store = createStore(":memory:"); stores.push(store); return store; };
  afterEach(() => stores.splice(0).forEach((store) => store.close()));

  const imageAsset = (store: ReturnType<typeof createStore>, projectId: string) => store.addAsset({ projectId, kind: "layer", name: "start.png", mime: "image/png", path: "/tmp/start.png", width: 1080, height: 1440, duration: null, hash: "fixture", provenance: "{}" });

  it("waits for an asset dependency and passes its output into a generation checkpoint once", () => {
    const store = storeFor(); const project = store.createProject("Carousel"); const asset = imageAsset(store, project.id);
    const workflow = store.createWorkflow("One shot", { nodes: [{ id: "shot", type: "generate-video", data: { modelId: "alibaba:wan2.7-i2v", prompt: "Move" } }, { id: "source", type: "asset", data: { assetId: asset.id } }], edges: [{ source: "source", target: "shot", targetRole: "start-image" }] });
    const run = store.createWorkflowRun(workflow.id, project.id, JSON.parse(workflow.graph));
    const first = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));
    const second = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));
    const [job] = store.listJobs(project.id);
    expect(first.createdJobs).toHaveLength(1); expect(second.createdJobs).toHaveLength(0); expect(JSON.parse(job.inputAssetIds)).toEqual([asset.id]);
  });

  it("fails an invalid image-to-video workflow before it creates a job", () => {
    const store = storeFor(); const project = store.createProject("Carousel");
    const workflow = store.createWorkflow("Invalid shot", { nodes: [{ id: "shot", type: "generate-video", data: { modelId: "alibaba:wan2.7-i2v", prompt: "Move" } }], edges: [] });
    const run = store.createWorkflowRun(workflow.id, project.id, JSON.parse(workflow.graph));
    const result = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));
    expect(result.createdJobs).toHaveLength(0); expect(store.listJobs(project.id)).toHaveLength(0); expect(result.state.nodes.shot.status).toBe("failed");
  });

  it("turns an approved Director proposal into exactly its reviewed jobs once", () => {
    const store = storeFor(); const project = store.createProject("Director project");
    const proposal = store.createProposal(project.id, "Make two shots", { shots: [{ prompt: "First", modelId: "alibaba:wan3-video", duration: 5, resolution: "720P" }, { prompt: "Second", modelId: "alibaba:wan3-video", duration: 5, resolution: "720P" }] });
    const first = approveProposalJobs(store, proposal.id, new Set(["alibaba:wan3-video"]));
    expect(first).toHaveLength(2); expect(() => approveProposalJobs(store, proposal.id, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/already approved/i);
  });

  it("does not approve or queue an invalid Director image-to-video proposal", () => {
    const store = storeFor(); const project = store.createProject("Director project");
    const proposal = store.createProposal(project.id, "Make a shot", { shots: [{ prompt: "First", modelId: "alibaba:wan2.7-i2v", duration: 5, resolution: "720P" }] });
    expect(() => approveProposalJobs(store, proposal.id, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/start image|required/i);
    expect(store.getProposal(proposal.id).approved_at).toBeNull(); expect(store.listJobs(project.id)).toHaveLength(0);
  });
});
