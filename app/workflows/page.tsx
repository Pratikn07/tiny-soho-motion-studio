"use client";

import { useCallback, useEffect, useState } from "react";
import { ReactFlow, Background, Controls, addEdge, useEdgesState, useNodesState, type Connection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type Project = { id: string; name: string };
type Workflow = { id: string; name: string; graph: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

const initialNodes = [
  { id: "input", position: { x: 40, y: 110 }, data: { label: "Asset input" }, type: "input" },
  { id: "shot", position: { x: 290, y: 110 }, data: { label: "Generate video" }, type: "default" },
  { id: "export", position: { x: 540, y: 110 }, data: { label: "Local export" }, type: "output" },
];
const initialEdges = [{ id: "input-shot", source: "input", target: "shot" }, { id: "shot-export", source: "shot", target: "export" }];

export default function WorkflowEditor() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("Build a local workflow, then run an immutable snapshot.");

  useEffect(() => { void Promise.all([api<Project[]>("/api/projects"), api<Workflow[]>("/api/workflows")]).then(([p, w]) => { setProjects(p); setProjectId(p[0]?.id || ""); setWorkflows(w); }); }, []);
  const connect = useCallback((connection: Connection) => setEdges((current) => addEdge(connection, current)), [setEdges]);
  const save = async () => {
    try {
      const graph = {
        nodes: nodes.map((node) => ({ id: node.id, type: node.id === "shot" ? "generate-video" : node.id === "input" ? "asset" : "export", data: node.id === "shot" ? { modelId: "alibaba:wan2.7-i2v", prompt: "Gentle ambient movement", inputAssetIds: [], inputRoles: [] } : {} })),
        edges: edges.map((edge) => ({ source: edge.source, target: edge.target })),
      };
      const workflow = await api<Workflow>("/api/workflows", { method: "POST", body: JSON.stringify({ name: "Custom visual workflow", graph }) });
      setWorkflows((current) => [workflow, ...current]); setSelected(workflow.id); setNotice("Saved a versioned workflow graph.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Workflow could not be saved"); }
  };
  const run = async () => {
    if (!selected || !projectId) return;
    try { const result = await api<any>(`/api/workflows/${selected}/runs`, { method: "POST", body: JSON.stringify({ projectId }) }); setNotice(`Run ${result.run.id.slice(-8)} created ${result.createdJobs.length} checkpointed job(s).`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Run could not start"); }
  };

  return <main className="board"><a href="/">← Studio</a><h1>Visual workflow builder</h1><p>Connect approved local steps. Generation nodes create durable jobs once; the worker resumes their run state after a restart.</p><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div style={{ height: 360, border: "1px solid #ddd7cd", borderRadius: 14, background: "#fffdf8" }}><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect} fitView><Background/><Controls/></ReactFlow></div><div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}><button className="batch" onClick={save}>Save workflow version</button><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose saved workflow</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select><button className="batch" onClick={run} disabled={!selected || !projectId}>Run selected workflow</button></div><p className="board-notice">{notice}</p></main>;
}
