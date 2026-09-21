"use client";

import { useEffect, useMemo, useState } from "react";

import type { StudioWorkflowRunView, StudioWorkflowView } from "@/lib/api";
import { getVideoModelContract, SINGAPORE_VIDEO_MODELS } from "@/lib/video-catalog";
import type { StudioAssetView, StudioProjectView } from "@/components/MotionStudio";

type WorkflowApi = {
  listProjects: () => Promise<StudioProjectView[]>;
  listAssets: (projectId: string) => Promise<StudioAssetView[]>;
  listWorkflows: (projectId: string) => Promise<StudioWorkflowView[]>;
  saveWorkflow: (input: { projectId: string; name: string; graph: Record<string, unknown> }) => Promise<StudioWorkflowView>;
  startWorkflowRun: (workflowId: string, input: { projectId: string; idempotencyKey: string }) => Promise<StudioWorkflowRunView>;
};

export function WorkflowStudio({ api }: { api: WorkflowApi }) {
  const [projects, setProjects] = useState<StudioProjectView[]>([]);
  const [projectId, setProjectId] = useState("");
  const [assets, setAssets] = useState<StudioAssetView[]>([]);
  const [workflows, setWorkflows] = useState<StudioWorkflowView[]>([]);
  const [workflowName, setWorkflowName] = useState("Asset to motion");
  const [modelId, setModelId] = useState("wan2.7-i2v");
  const [assetId, setAssetId] = useState("");
  const [prompt, setPrompt] = useState("Gentle ambient movement with a stable product silhouette.");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [message, setMessage] = useState("");
  const contract = getVideoModelContract(modelId) ?? getVideoModelContract("wan2.7-i2v")!;
  const sourceRole = contract.requiredRoles[0] ?? contract.requiresAnyRole?.[0] ?? null;
  const sourceAssets = useMemo(() => assets.filter((asset) => asset.kind === "source-image" || asset.kind === "derived-image"), [assets]);

  useEffect(() => {
    void api.listProjects().then((items) => { setProjects(items); setProjectId((current) => current || items[0]?.id || ""); }).catch(() => setMessage("Projects could not be loaded."));
  }, [api]);
  useEffect(() => {
    if (!projectId) return;
    void Promise.all([api.listAssets(projectId), api.listWorkflows(projectId)]).then(([nextAssets, nextWorkflows]) => {
      setAssets(nextAssets); setWorkflows(nextWorkflows); setAssetId((current) => current || nextAssets.find((asset) => asset.kind === "source-image" || asset.kind === "derived-image")?.id || "");
    }).catch(() => setMessage("Workflow resources could not be loaded."));
  }, [api, projectId]);

  const save = async () => {
    if (!projectId || (sourceRole && !assetId)) return;
    const nodes: Array<Record<string, unknown>> = [{ id: "shot", type: "generate-video", data: { modelId: contract.id, prompt, options: contract.defaultOptions } }];
    const edges: Array<Record<string, unknown>> = [];
    if (sourceRole && assetId) {
      nodes.unshift({ id: "asset", type: "asset", data: { assetId } });
      edges.push({ source: "asset", sourceOutput: "asset", target: "shot", targetInput: `media:${sourceRole}` });
    }
    try {
      const workflow = await api.saveWorkflow({ projectId, name: workflowName, graph: { version: 2, nodes, edges } });
      setWorkflows((items) => [workflow, ...items.filter((item) => item.id !== workflow.id)]);
      setSelectedWorkflowId(workflow.id);
      setMessage("Saved an immutable V2 workflow snapshot.");
    } catch {
      setMessage("Workflow could not be saved. Check the model inputs and Vision capabilities.");
    }
  };
  const run = async () => {
    if (!projectId || !selectedWorkflowId) return;
    try {
      const run = await api.startWorkflowRun(selectedWorkflowId, { projectId, idempotencyKey: crypto.randomUUID() });
      setMessage(`Workflow run ${run.id.slice(-8)} is queued. It will wait for upstream outputs when needed.`);
    } catch { setMessage("Workflow run could not be queued."); }
  };

  return <section className="suite-view" aria-label="Workflows"><div><p className="eyebrow">Orchestrate safely</p><h2>Workflows</h2><p>Build an asset-to-video V2 graph. Runs snapshot the graph and schedule durable child jobs only when dependencies complete.</p></div><div className="panel"><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Workflow name<input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} /></label><label>Video model<select value={contract.id} onChange={(event) => setModelId(event.target.value)}>{SINGAPORE_VIDEO_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>{sourceRole ? <label>Source image for {sourceRole.replaceAll("_", " ")}<select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Select source image</option>{sourceAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label> : <p className="note">This model can begin without a source asset.</p>}<label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><button type="button" disabled={!projectId || Boolean(sourceRole && !assetId)} onClick={() => void save()}>Save workflow</button></div><div className="panel"><h3>Saved workflows</h3><div className="row"><select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)}><option value="">Select a workflow</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select><button type="button" disabled={!selectedWorkflowId} onClick={() => void run()}>Start run</button></div></div>{message ? <p role="status">{message}</p> : null}</section>;
}
