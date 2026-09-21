"use client";

import { useEffect, useState } from "react";

import type { StudioDirectorProposalView, StudioDirectorRequestView } from "@/lib/api";
import type { StudioProjectView } from "@/components/MotionStudio";

type DirectorApi = {
  listProjects: () => Promise<StudioProjectView[]>;
  createDirectorDraft: (input: { projectId: string; idempotencyKey: string; brief: string }) => Promise<StudioDirectorRequestView>;
  getDirectorRequest: (requestId: string) => Promise<StudioDirectorRequestView>;
  getDirectorProposal: (proposalId: string) => Promise<StudioDirectorProposalView>;
  approveDirectorProposal: (proposalId: string) => Promise<Array<{ id: string; status: string }>>;
};

export function DirectorStudio({ api }: { api: DirectorApi }) {
  const [projects, setProjects] = useState<StudioProjectView[]>([]);
  const [projectId, setProjectId] = useState("");
  const [brief, setBrief] = useState("");
  const [request, setRequest] = useState<StudioDirectorRequestView | null>(null);
  const [proposal, setProposal] = useState<StudioDirectorProposalView | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void api.listProjects().then((items) => {
      setProjects(items);
      setProjectId((current) => current || items[0]?.id || "");
    }).catch(() => setMessage("Projects could not be loaded."));
  }, [api]);

  useEffect(() => {
    if (!request || !["queued", "running"].includes(request.status)) return;
    const timer = window.setInterval(() => {
      void api.getDirectorRequest(request.id).then((next) => {
        setRequest(next);
        if (next.proposalId) void api.getDirectorProposal(next.proposalId).then(setProposal);
      }).catch(() => setMessage("Director status could not be refreshed."));
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [api, request]);

  const draft = async () => {
    if (!projectId || !brief.trim()) return;
    try {
      const next = await api.createDirectorDraft({ projectId, brief: brief.trim(), idempotencyKey: crypto.randomUUID() });
      setRequest(next);
      setProposal(null);
      setMessage("Director brief is queued. It will remain a draft until you explicitly approve it.");
    } catch {
      setMessage("Director draft could not be queued.");
    }
  };

  const approve = async () => {
    if (!proposal) return;
    try {
      const jobs = await api.approveDirectorProposal(proposal.id);
      setProposal((current) => current ? { ...current, status: "approved" } : current);
      setMessage(`${jobs.length} validated motion job${jobs.length === 1 ? "" : "s"} queued after approval.`);
    } catch {
      setMessage("Approval needs a current model acknowledgement and valid owned assets.");
    }
  };

  const snapshot = proposal?.snapshot as { title?: string; note?: string; shots?: Array<{ modelId?: string; prompt?: string }> } | undefined;
  return <section className="suite-view" aria-label="Creative Director">
    <div><p className="eyebrow">Plan safely</p><h2>Creative Director</h2><p>Turn a brief into an immutable video proposal. Drafting never submits a provider job.</p></div>
    <div className="panel">
      <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Creative brief<textarea value={brief} onChange={(event) => setBrief(event.target.value)} maxLength={5000} placeholder="Describe the story, rhythm, product, and references." /></label>
      <button type="button" disabled={!projectId || !brief.trim()} onClick={() => void draft()}>Create Director draft</button>
    </div>
    {request ? <div className="panel"><h3>Draft status</h3><p>{request.status}{request.errorMessage ? ` — ${request.errorMessage}` : ""}</p></div> : null}
    {proposal && snapshot ? <div className="panel"><h3>{snapshot.title ?? "Director proposal"}</h3><p>{snapshot.note}</p><ol>{snapshot.shots?.map((shot, index) => <li key={`${shot.modelId}-${index}`}><strong>{shot.modelId}</strong>: {shot.prompt}</li>)}</ol><button type="button" disabled={proposal.status !== "drafted"} onClick={() => void approve()}>Approve and queue validated jobs</button></div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
