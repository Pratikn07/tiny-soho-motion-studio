"use client";

import { useEffect, useMemo, useState } from "react";

export type StudioProjectView = {
  id: string;
  name: string;
  canvas: string;
  freeQuotaModels: string[];
  freeQuotaConfirmedAt: Record<string, string>;
};

export type StudioAssetView = {
  id: string;
  kind: "source-image" | "generated-video";
  name: string;
  mimeType: string;
};

export type StudioJobView = {
  id: string;
  status: string;
  modelId: string;
  outputUrl?: string;
  errorMessage?: string | null;
};

export type MotionStudioApi = {
  listProjects: () => Promise<StudioProjectView[]>;
  createProject?: (input: { name: string; canvas: string }) => Promise<StudioProjectView>;
  updateProjectQuota?: (projectId: string, input: { freeQuotaModels: string[]; freeQuotaConfirmedAt: Record<string, string> }) => Promise<StudioProjectView>;
  listAssets?: (projectId: string) => Promise<StudioAssetView[]>;
  uploadAsset?: (projectId: string, file: File) => Promise<StudioAssetView>;
  createJob?: (input: {
    projectId: string;
    idempotencyKey: string;
    modelId: "wan2.7-i2v" | "wan3-video";
    prompt: string;
    media: Array<{ assetId: string; role: "start-image" | "end-image" }>;
    options: { duration: number; resolution: string; aspectRatio?: string };
  }) => Promise<StudioJobView>;
  getJob?: (jobId: string) => Promise<StudioJobView>;
};

const modelOptions = {
  "wan2.7-i2v": { label: "Wan 2.7 I2V", resolutions: ["720P", "1080P"], ratios: [] },
  "wan3-video": { label: "Wan 3 Video", resolutions: ["480P", "720P", "1080P"], ratios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
} as const;

export function MotionStudio({ api }: { api: MotionStudioApi }) {
  const [projects, setProjects] = useState<StudioProjectView[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [assets, setAssets] = useState<StudioAssetView[]>([]);
  const [jobs, setJobs] = useState<StudioJobView[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("Untitled motion");
  const [modelId, setModelId] = useState<"wan2.7-i2v" | "wan3-video">("wan2.7-i2v");
  const [prompt, setPrompt] = useState("");
  const [startAssetId, setStartAssetId] = useState("");
  const [endAssetId, setEndAssetId] = useState("");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720P");
  const [aspectRatio, setAspectRatio] = useState("adaptive");
  const [message, setMessage] = useState("");

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const sourceAssets = useMemo(() => assets.filter((asset) => asset.kind === "source-image"), [assets]);
  const freeQuotaConfirmed = Boolean(selectedProject?.freeQuotaModels.includes(modelId));
  const canGenerate = Boolean(selectedProject && startAssetId && freeQuotaConfirmed && api.createJob);
  const activeModel = modelOptions[modelId];

  useEffect(() => {
    void api.listProjects().then((items) => {
      setProjects(items);
      setSelectedProjectId((current) => current || items[0]?.id || "");
    }).catch(() => setMessage("Projects could not be loaded."));
  }, [api]);

  useEffect(() => {
    if (!selectedProjectId || !api.listAssets) {
      setAssets([]);
      return;
    }
    void api.listAssets(selectedProjectId).then(setAssets).catch(() => setMessage("Assets could not be loaded."));
  }, [api, selectedProjectId]);

  useEffect(() => {
    if (!api.getJob) return;
    const pendingJobIds = jobs
      .filter((job) => !["completed", "failed", "needs_attention", "canceled"].includes(job.status))
      .map((job) => job.id);
    if (!pendingJobIds.length) return;
    const interval = window.setInterval(() => {
      void Promise.all(pendingJobIds.map((id) => api.getJob!(id))).then((updates) => {
        setJobs((items) => items.map((job) => updates.find((update) => update.id === job.id) ?? job));
      }).catch(() => setMessage("Job status could not be refreshed."));
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [api, jobs]);

  const createProject = async () => {
    if (!api.createProject || !projectName.trim()) return;
    try {
      const project = await api.createProject({ name: projectName.trim(), canvas: "1080x1920" });
      setProjects((items) => [project, ...items]);
      setSelectedProjectId(project.id);
      setShowNewProject(false);
      setMessage("");
    } catch {
      setMessage("Project could not be created.");
    }
  };

  const confirmQuota = async (checked: boolean) => {
    if (!selectedProject || !api.updateProjectQuota) return;
    const freeQuotaModels = checked
      ? [...new Set([...selectedProject.freeQuotaModels, modelId])]
      : selectedProject.freeQuotaModels.filter((item) => item !== modelId);
    const freeQuotaConfirmedAt = { ...selectedProject.freeQuotaConfirmedAt };
    if (checked) freeQuotaConfirmedAt[modelId] = new Date().toISOString();
    else delete freeQuotaConfirmedAt[modelId];
    try {
      const project = await api.updateProjectQuota(selectedProject.id, { freeQuotaModels, freeQuotaConfirmedAt });
      setProjects((items) => items.map((item) => item.id === project.id ? project : item));
      setMessage("");
    } catch {
      setMessage("Free Quota confirmation could not be saved.");
    }
  };

  const uploadAsset = async (file: File | undefined) => {
    if (!file || !selectedProject || !api.uploadAsset) return;
    try {
      const asset = await api.uploadAsset(selectedProject.id, file);
      setAssets((items) => [asset, ...items]);
      setStartAssetId((current) => current || asset.id);
      setMessage("");
    } catch {
      setMessage("Image upload failed.");
    }
  };

  const generate = async () => {
    if (!selectedProject || !startAssetId || !canGenerate || !api.createJob) return;
    try {
      const job = await api.createJob({
        projectId: selectedProject.id,
        idempotencyKey: crypto.randomUUID(),
        modelId,
        prompt,
        media: [
          { assetId: startAssetId, role: "start-image" },
          ...(endAssetId ? [{ assetId: endAssetId, role: "end-image" as const }] : []),
        ],
        options: { duration, resolution, ...(activeModel.ratios.length ? { aspectRatio } : {}) },
      });
      setJobs((items) => [job, ...items]);
      setMessage("Generation submitted. The page checks its status while it remains open.");
    } catch {
      setMessage("Generation could not be submitted.");
    }
  };

  return (
    <main className="studio-shell">
      <header>
        <p className="eyebrow">Tiny Soho</p>
        <h1>Motion Studio</h1>
        <p>Create a single Wan image-to-video motion study with an optional exact end frame.</p>
      </header>

      {message ? <p role="status">{message}</p> : null}

      <section className="panel" aria-label="Projects">
        <div className="row">
          <label>
            Project
            <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
              <option value="">Select a project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setShowNewProject(true)}>New project</button>
        </div>
        {showNewProject ? (
          <div className="row">
            <label>
              New project name
              <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </label>
            <button type="button" onClick={() => void createProject()}>Create project</button>
          </div>
        ) : null}
      </section>

      {selectedProject || showNewProject ? (
        <section className="panel" aria-label="Generation settings">
          <h2>Settings</h2>
          <label>
            Model
            <select value={modelId} onChange={(event) => {
              const next = event.target.value as keyof typeof modelOptions;
              setModelId(next);
              setResolution(modelOptions[next].resolutions[0]);
              setAspectRatio(modelOptions[next].ratios[0] ?? "adaptive");
            }}>
              {Object.entries(modelOptions).map(([id, model]) => <option key={id} value={id}>{model.label}</option>)}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={freeQuotaConfirmed}
              disabled={!selectedProject}
              onChange={(event) => void confirmQuota(event.target.checked)}
            />
            Confirm Free Quota for this model
          </label>
          <p className="note">Generation stays disabled until this project has an explicit Free Quota confirmation and a start frame.</p>
        </section>
      ) : null}

      <section className="panel" aria-label="Frames">
        <h2>Frames</h2>
        <label>
          Upload source image
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!selectedProject} onChange={(event) => void uploadAsset(event.target.files?.[0])} />
        </label>
        <div className="row">
          <label>
            Start frame
            <select value={startAssetId} disabled={!selectedProject} onChange={(event) => setStartAssetId(event.target.value)}>
              <option value="">Select a start frame</option>
              {sourceAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
          </label>
          <label>
            End frame (optional)
            <select value={endAssetId} disabled={!selectedProject} onChange={(event) => setEndAssetId(event.target.value)}>
              <option value="">No end frame</option>
              {sourceAssets.filter((asset) => asset.id !== startAssetId).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel" aria-label="Generate motion">
        <h2>Generate</h2>
        <label>
          Motion prompt
          <textarea value={prompt} maxLength={5000} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the camera movement and subtle motion." />
        </label>
        <div className="row">
          <label>
            Duration
            <input type="number" min={2} max={modelId === "wan2.7-i2v" ? 15 : 30} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
          </label>
          <label>
            Resolution
            <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
              {activeModel.resolutions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {activeModel.ratios.length ? <label>
            Ratio
            <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
              {activeModel.ratios.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label> : null}
        </div>
        <button type="button" disabled={!canGenerate} onClick={() => void generate()}>Generate</button>
      </section>

      {jobs.length ? <section className="panel" aria-label="Jobs">
        <h2>Jobs</h2>
        <ul>{jobs.map((job) => <li key={job.id}>{job.modelId}: {job.status} {job.outputUrl ? <a href={job.outputUrl}>Open video</a> : null} {job.errorMessage ? `— ${job.errorMessage}` : null}</li>)}</ul>
      </section> : null}
    </main>
  );
}
