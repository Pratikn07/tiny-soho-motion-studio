import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "@/lib/store";
import { executeWorkflowRun, validateWorkflow } from "@/lib/workflows";
import { approveProposalJobs, validateDirectorProposal } from "@/lib/proposals";

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

  it("executes a V2 named output port and preserves its explicit input role", () => {
    const store = storeFor(); const project = store.createProject("Port graph"); const asset = imageAsset(store, project.id);
    const workflow = store.createWorkflow("V2 one shot", { version: 2, nodes: [{ id: "shot", type: "generate-video", data: { modelId: "alibaba:wan2.7-i2v", prompt: "Move" } }, { id: "source", type: "asset", data: { assetId: asset.id } }], edges: [{ source: "source", sourcePort: "asset", target: "shot", targetPort: "media:start-image" }] });
    const run = store.createWorkflowRun(workflow.id, project.id, JSON.parse(workflow.graph));
    const result = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));

    expect(result.createdJobs).toHaveLength(1);
    expect(JSON.parse(store.listJobs(project.id)[0].options).media).toEqual([{ assetId: asset.id, role: "start-image" }]);
  });

  it("routes multiple named structured asset outputs through the V2 sourceOutput and targetInput contract", () => {
    const store = storeFor(); const project = store.createProject("Multi-output graph"); const start = imageAsset(store, project.id); const end = imageAsset(store, project.id);
    const workflow = store.createWorkflow("V2 multi-output", { version: 2, nodes: [{ id: "shot", type: "generate-video", data: { modelId: "alibaba:wan2.7-i2v", prompt: "Move" } }, { id: "source", type: "asset", data: { outputs: { start: start.id, end: end.id } } }], edges: [{ source: "source", sourceOutput: "start", target: "shot", targetInput: "media:start-image" }, { source: "source", sourceOutput: "end", target: "shot", targetInput: "media:end-image" }] });
    const run = store.createWorkflowRun(workflow.id, project.id, JSON.parse(workflow.graph));
    const result = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));

    expect(result.createdJobs).toHaveLength(1);
    expect(JSON.parse(store.listJobs(project.id)[0].options).media).toEqual([{ assetId: start.id, role: "start-image" }, { assetId: end.id, role: "end-image" }]);
    expect(result.state.nodes.source.outputs).toEqual({ start: { assetId: start.id }, end: { assetId: end.id } });
  });

  it("rejects an unknown V2 source output or Vision target input before execution", () => {
    const graph = { version: 2, nodes: [{ id: "asset", type: "asset", data: { assetId: "asset_1" } }, { id: "ocr", type: "vision-ocr" }], edges: [{ source: "asset", sourceOutput: "unknown", target: "ocr", targetInput: "unexpected" }] };
    expect(() => validateWorkflow(graph)).toThrow(/source output.*not declared/i);
  });

  it("continues a legacy run whose completed node stored a string output value", () => {
    const store = storeFor(); const project = store.createProject("Legacy run"); const asset = imageAsset(store, project.id);
    const workflow = store.createWorkflow("Legacy output", { nodes: [{ id: "shot", type: "generate-video", data: { modelId: "alibaba:wan2.7-i2v", prompt: "Move" } }, { id: "source", type: "asset", data: { assetId: asset.id } }], edges: [{ source: "source", target: "shot", targetRole: "start-image" }] });
    const run = store.createWorkflowRun(workflow.id, project.id, JSON.parse(workflow.graph));
    store.updateWorkflowRun(run.id, { status: "running", nodes: { source: { status: "completed", outputAssetId: asset.id, outputs: { asset: asset.id } } } });

    expect(executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"])).createdJobs).toHaveLength(1);
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

  it("does not approve or queue a Director proposal with an untransportable local reference video", () => {
    const store = storeFor(); const project = store.createProject("Director transport");
    const video = store.addAsset({ projectId: project.id, kind: "reference", name: "reference.mp4", mime: "video/mp4", path: "/tmp/reference.mp4", width: 320, height: 320, duration: 2, hash: "reference", provenance: "{}" });
    const proposal = store.createProposal(project.id, "Use local video", { shots: [{ prompt: "Move", modelId: "alibaba:wan2.7-r2v", duration: 5, resolution: "720P", media: [{ assetId: video.id, role: "reference-video" }] }] });

    expect(() => approveProposalJobs(store, proposal.id, new Set(["alibaba:wan2.7-r2v"]))).toThrow(/reference video.*transport is not verified/i);
    expect(store.getProposal(proposal.id).approved_at).toBeNull(); expect(store.listJobs(project.id)).toHaveLength(0);
  });

  it("resumes a completed generation job as structured named workflow outputs", () => {
    const store = storeFor(); const project = store.createProject("Workflow resume"); const source = imageAsset(store, project.id); const output = store.addAsset({ projectId: project.id, kind: "video", name: "result.mp4", mime: "video/mp4", path: "/tmp/result.mp4", width: 1080, height: 1440, duration: 5, hash: "output", provenance: "{}" });
    const workflow = store.createWorkflow("Resumed output", { version: 2, nodes: [{ id: "source", type: "asset", data: { assetId: source.id } }, { id: "shot", type: "generate-video", data: { modelId: "alibaba:wan2.7-i2v", prompt: "Move" } }], edges: [{ source: "source", sourceOutput: "asset", target: "shot", targetInput: "media:start-image" }] });
    const run = store.createWorkflowRun(workflow.id, project.id, JSON.parse(workflow.graph));
    const first = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));
    const job = store.getJob(first.createdJobs[0].id)!;
    store.updateJob(job.id, { status: "completed", outputAssetId: output.id });

    const resumed = executeWorkflowRun(store, run.id, new Set(["alibaba:wan2.7-i2v"]));
    expect(resumed.state).toMatchObject({ status: "completed", nodes: { shot: { status: "completed", outputs: { output: { assetId: output.id }, "raw-video": { assetId: output.id } } } } });
  });

  it("rejects a Director draft that invents a project media reference", () => {
    expect(() => validateDirectorProposal({ projectId: "project_1", shots: [{ prompt: "Move", modelId: "alibaba:wan2.7-r2v", media: [{ assetId: "asset_invented", role: "reference-image" }] }] }, { projectId: "project_1", allowedAssetIds: new Set(["asset_real"]) })).toThrow(/not available in this project/i);
  });

  it("rejects a Director draft that invents an evidence reference", () => {
    expect(() => validateDirectorProposal({ projectId: "project_1", shots: [{ prompt: "Move", modelId: "alibaba:wan3-video", evidenceRefs: ["technique:invented"] }] }, { projectId: "project_1", allowedAssetIds: new Set(), allowedEvidenceRefs: new Set(["technique:real"]) })).toThrow(/evidence.*not available/i);
  });
});
