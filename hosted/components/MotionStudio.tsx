"use client";

import { useEffect, useMemo, useState } from "react";

import { ModelPicker } from "@/components/ModelPicker";
import {
  getVideoModelContract,
  type MediaRole,
  type ModelAcknowledgement,
  type VideoOptions,
} from "@/lib/video-catalog";

export type StudioProjectView = {
  id: string;
  name: string;
  canvas: string;
  freeQuotaModels: string[];
  freeQuotaConfirmedAt: Record<string, string>;
};

export type StudioAssetView = {
  id: string;
  kind: "source-image" | "source-video" | "source-audio" | "generated-video" | "derived-image" | "derived-video";
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
  listAssets?: (projectId: string) => Promise<StudioAssetView[]>;
  uploadAsset?: (projectId: string, file: File) => Promise<StudioAssetView>;
  listAcknowledgements?: () => Promise<ModelAcknowledgement[]>;
  acknowledgeModel?: (input: { modelId: string; contractVersion: string }) => Promise<ModelAcknowledgement>;
  createJob?: (input: {
    projectId: string;
    idempotencyKey: string;
    modelId: string;
    prompt: string;
    media: Array<{ assetId: string; role: MediaRole; ordinal?: number }>;
    options: Record<string, unknown>;
  }) => Promise<StudioJobView>;
  getJob?: (jobId: string) => Promise<StudioJobView>;
};

const assetKindForRole: Record<MediaRole, StudioAssetView["kind"]> = {
  first_frame: "source-image",
  last_frame: "source-image",
  mask_image: "source-image",
  reference_image: "source-image",
  reference_video: "source-video",
  source_video: "source-video",
  driving_video: "source-video",
  driving_audio: "source-audio",
  first_clip: "source-video",
};

const labelForRole = (role: MediaRole) => role.replaceAll("_", " ");

export function jobStatusDetail(status: string) {
  const detail: Record<string, string> = {
    queued: "Waiting for the Creative Worker to pick up your request.",
    submitting: "Preparing your request for Alibaba Model Studio.",
    submitted: "Submitted to Alibaba; waiting for rendering to begin.",
    running: "Alibaba is rendering your video.",
    downloading: "Saving the completed video to your project.",
    completed: "Your video is ready.",
    failed: "Alibaba could not complete this generation.",
    needs_attention: "This generation needs review before it can continue.",
    canceled: "This generation was canceled.",
  };
  return detail[status] ?? "Processing status is updating.";
}

export function MotionStudio({ api }: { api: MotionStudioApi }) {
  const [projects, setProjects] = useState<StudioProjectView[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [assets, setAssets] = useState<StudioAssetView[]>([]);
  const [jobs, setJobs] = useState<StudioJobView[]>([]);
  const [acknowledgements, setAcknowledgements] = useState<ModelAcknowledgement[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectName, setProjectName] = useState("Untitled creative");
  const [modelId, setModelId] = useState("wan2.7-i2v");
  const [prompt, setPrompt] = useState("");
  const [media, setMedia] = useState<Array<{ assetId: string; role: MediaRole }>>([]);
  const [optionalRole, setOptionalRole] = useState<MediaRole | "">("");
  const [optionalAssetId, setOptionalAssetId] = useState("");
  const [options, setOptions] = useState<VideoOptions>(() => getVideoModelContract("wan2.7-i2v")!.defaultOptions);
  const [message, setMessage] = useState("");

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const contract = getVideoModelContract(modelId);
  const activeContract = contract ?? getVideoModelContract("wan2.7-i2v")!;
  const acknowledged = acknowledgements.some((entry) => (
    entry.modelId === activeContract.id && entry.contractVersion === activeContract.contractVersion
  ));
  const requiredReady = activeContract.requiredRoles.every((role) => media.some((entry) => entry.role === role));
  const referenceReady = !activeContract.requiresAnyRole || activeContract.requiresAnyRole.some((role) => media.some((entry) => entry.role === role));
  const promptReady = !activeContract.promptRequired || Boolean(prompt.trim());
  const canGenerate = Boolean(selectedProject && acknowledged && requiredReady && referenceReady && promptReady && api.createJob);
  const selectableAssets = useMemo(() => assets.filter((asset) => asset.kind !== "generated-video"), [assets]);

  useEffect(() => {
    void api.listProjects().then((items) => {
      setProjects(items);
      setSelectedProjectId((current) => current || items[0]?.id || "");
    }).catch(() => setMessage("Projects could not be loaded."));
  }, [api]);

  useEffect(() => {
    if (!api.listAcknowledgements) return;
    void api.listAcknowledgements().then(setAcknowledgements).catch(() => setMessage("Model acknowledgements could not be loaded."));
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
    const pendingJobIds = jobs.filter((job) => !["completed", "failed", "needs_attention", "canceled"].includes(job.status)).map((job) => job.id);
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

  const selectModel = (nextModelId: string) => {
    const next = getVideoModelContract(nextModelId);
    if (!next) return;
    setModelId(next.id);
    setMedia([]);
    setOptionalRole("");
    setOptionalAssetId("");
    setOptions(next.defaultOptions);
  };

  const acknowledge = async (model: { id: string; contractVersion: string }) => {
    if (!api.acknowledgeModel) return;
    try {
      const acknowledgement = await api.acknowledgeModel({ modelId: model.id, contractVersion: model.contractVersion });
      setAcknowledgements((items) => [...items.filter((item) => item.modelId !== acknowledgement.modelId || item.contractVersion !== acknowledgement.contractVersion), acknowledgement]);
      setMessage("");
    } catch {
      setMessage("Model acknowledgement could not be saved.");
    }
  };

  const uploadAsset = async (file: File | undefined) => {
    if (!file || !selectedProject || !api.uploadAsset) return;
    try {
      const asset = await api.uploadAsset(selectedProject.id, file);
      setAssets((items) => [asset, ...items]);
      setMessage("");
    } catch {
      setMessage("Source media upload failed.");
    }
  };

  const setRequiredMedia = (role: MediaRole, assetId: string) => {
    setMedia((items) => [
      ...items.filter((item) => item.role !== role),
      ...(assetId ? [{ assetId, role }] : []),
    ]);
  };

  const addOptionalMedia = () => {
    if (!optionalRole || !optionalAssetId) return;
    const allowed = activeContract.maxByRole[optionalRole] ?? 1;
    if (media.filter((item) => item.role === optionalRole).length >= allowed) return;
    setMedia((items) => [...items, { assetId: optionalAssetId, role: optionalRole }]);
    setOptionalAssetId("");
  };

  const generate = async () => {
    if (!selectedProject || !canGenerate || !api.createJob) return;
    try {
      const job = await api.createJob({
        projectId: selectedProject.id,
        idempotencyKey: crypto.randomUUID(),
        modelId: activeContract.id,
        prompt,
        media: media.map((entry, index) => ({ ...entry, ordinal: index + 1 })),
        options,
      });
      setJobs((items) => [job, ...items]);
      setMessage(jobStatusDetail(job.status));
    } catch {
      setMessage("Generation could not be queued.");
    }
  };

  const availableAssetsFor = (role: MediaRole) => selectableAssets.filter((asset) => asset.kind === assetKindForRole[role]);
  const optionalRoles = activeContract.optionalRoles.filter((role) => (activeContract.maxByRole[role] ?? 1) > media.filter((item) => item.role === role).length);

  return (
    <section className="suite-view" aria-label="Motion Studio">
      <header>
        <p className="eyebrow">Generate</p>
        <h2>Motion</h2>
        <p>Use the Singapore Model Studio video catalogue with private, durable Creative jobs.</p>
      </header>

      {message ? <p role="status">{message}</p> : null}

      <section className="panel" aria-label="Projects">
        <div className="row">
          <label>Project<select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">Select a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <button type="button" onClick={() => setShowNewProject(true)}>New project</button>
        </div>
        {showNewProject ? <div className="row"><label>New project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><button type="button" onClick={() => void createProject()}>Create project</button></div> : null}
      </section>

      <section id="motion" className="panel" aria-label="Generation settings">
        <h2>Model and billing acknowledgement</h2>
        <ModelPicker selectedId={activeContract.id} acknowledgements={acknowledgements} onChange={selectModel} onAcknowledge={(model) => void acknowledge(model)} />
      </section>

      <section id="assets" className="panel" aria-label="Source media">
        <h2>Source media</h2>
        <label>Upload image, video, or audio<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/mp4" disabled={!selectedProject} onChange={(event) => void uploadAsset(event.target.files?.[0])} /></label>
        {activeContract.requiredRoles.length ? <div className="row">{activeContract.requiredRoles.map((role) => <label key={role}>{labelForRole(role)}<select value={media.find((item) => item.role === role)?.assetId ?? ""} disabled={!selectedProject} onChange={(event) => setRequiredMedia(role, event.target.value)}><option value="">Select {labelForRole(role)}</option>{availableAssetsFor(role).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>)}</div> : <p className="note">{activeContract.requiresAnyRole ? "Add one of the supported source inputs below." : "This model needs no source media."}</p>}
        {optionalRoles.length ? <div className="row"><label>Optional input role<select value={optionalRole} onChange={(event) => setOptionalRole(event.target.value as MediaRole | "")}><option value="">Select an input role</option>{optionalRoles.map((role) => <option key={role} value={role}>{labelForRole(role)}</option>)}</select></label><label>Optional asset<select value={optionalAssetId} onChange={(event) => setOptionalAssetId(event.target.value)}><option value="">Select an asset</option>{optionalRole ? availableAssetsFor(optionalRole).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>) : null}</select></label><button type="button" onClick={addOptionalMedia}>Add input</button></div> : null}
        {activeContract.task === "reference-to-video" && activeContract.optionalRoles.includes("driving_audio") ? <p className="note">For Wan 2.7 reference voices, add all reference images or videos first, then add audio files in the matching reference order.</p> : null}
        {media.length ? <ul>{media.map((entry, index) => <li key={`${entry.role}-${entry.assetId}-${index}`}>{labelForRole(entry.role)}: {assets.find((asset) => asset.id === entry.assetId)?.name ?? entry.assetId} <button type="button" onClick={() => setMedia((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></li>)}</ul> : null}
      </section>

      <section className="panel" aria-label="Generate motion">
        <h2>Generate</h2>
        <label>Prompt<textarea value={prompt} maxLength={activeContract.promptMax} onChange={(event) => setPrompt(event.target.value)} placeholder={activeContract.promptRequired ? "Describe the result you want." : "Optional prompt"} /></label>
        <div className="row">
          {activeContract.duration && activeContract.optionKeys.includes("duration") ? <label>Duration{activeContract.duration.values ? <select value={options.duration ?? activeContract.duration.values[0]} onChange={(event) => setOptions((value) => ({ ...value, duration: Number(event.target.value) }))}>{activeContract.duration.values.map((duration) => <option key={duration} value={duration}>{duration}s</option>)}</select> : <input type="number" min={activeContract.duration.min} max={activeContract.duration.max} value={options.duration ?? ""} placeholder={activeContract.task === "video-edit" ? "Keep input duration" : undefined} onChange={(event) => setOptions((value) => ({ ...value, ...(event.target.value ? { duration: Number(event.target.value) } : { duration: undefined }) }))} />}</label> : null}
          {activeContract.resolutions && activeContract.optionKeys.includes("resolution") ? <label>Resolution<select value={options.resolution ?? activeContract.resolutions[0]} onChange={(event) => setOptions((value) => ({ ...value, resolution: event.target.value as VideoOptions["resolution"] }))}>{activeContract.resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}</select></label> : null}
          {activeContract.aspectRatios && activeContract.optionKeys.includes("aspectRatio") ? <label>Aspect ratio<select value={options.aspectRatio ?? activeContract.aspectRatios[0]} onChange={(event) => setOptions((value) => ({ ...value, aspectRatio: event.target.value as VideoOptions["aspectRatio"] }))}>{activeContract.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label> : null}
          {activeContract.optionKeys.includes("shotType") ? <label>Shot type<select value={options.shotType ?? "single"} onChange={(event) => setOptions((value) => ({ ...value, shotType: event.target.value as VideoOptions["shotType"] }))}><option value="single">Single shot</option><option value="multi">Multi-shot</option></select></label> : null}
          {activeContract.optionKeys.includes("audio") ? <label><input type="checkbox" checked={options.audio ?? false} onChange={(event) => setOptions((value) => ({ ...value, audio: event.target.checked }))} /> Generate audio</label> : null}
          {activeContract.optionKeys.includes("audioSetting") ? <label>Sound<select value={options.audioSetting ?? "auto"} onChange={(event) => setOptions((value) => ({ ...value, audioSetting: event.target.value as VideoOptions["audioSetting"] }))}><option value="auto">Auto</option><option value="origin">Keep original</option></select></label> : null}
          {activeContract.optionKeys.includes("maskFrameId") ? <label>Mask frame<input type="number" min={0} required value={options.maskFrameId ?? ""} onChange={(event) => setOptions((value) => ({ ...value, ...(event.target.value ? { maskFrameId: Number(event.target.value) } : { maskFrameId: undefined }) }))} /></label> : null}
          {activeContract.optionKeys.includes("maskType") ? <label>Mask tracking<select value={options.maskType ?? "tracking"} onChange={(event) => setOptions((value) => ({ ...value, maskType: event.target.value as VideoOptions["maskType"] }))}><option value="tracking">Tracking</option><option value="manual">Manual</option></select></label> : null}
          {activeContract.optionKeys.includes("expandRatio") ? <label>Mask expansion<input type="number" min={0} max={1} step={0.01} value={options.expandRatio ?? 0} onChange={(event) => setOptions((value) => ({ ...value, expandRatio: Number(event.target.value) }))} /></label> : null}
        </div>
        {activeContract.optionKeys.some((key) => ["topScale", "bottomScale", "leftScale", "rightScale"].includes(key)) ? <div className="row"><label>Top expansion<input type="number" min={1} max={2} step={0.1} value={options.topScale ?? 1} onChange={(event) => setOptions((value) => ({ ...value, topScale: Number(event.target.value) }))} /></label><label>Bottom expansion<input type="number" min={1} max={2} step={0.1} value={options.bottomScale ?? 1} onChange={(event) => setOptions((value) => ({ ...value, bottomScale: Number(event.target.value) }))} /></label><label>Left expansion<input type="number" min={1} max={2} step={0.1} value={options.leftScale ?? 1} onChange={(event) => setOptions((value) => ({ ...value, leftScale: Number(event.target.value) }))} /></label><label>Right expansion<input type="number" min={1} max={2} step={0.1} value={options.rightScale ?? 1} onChange={(event) => setOptions((value) => ({ ...value, rightScale: Number(event.target.value) }))} /></label></div> : null}
        <button type="button" disabled={!canGenerate} onClick={() => void generate()}>Generate</button>
      </section>

      {jobs.length ? <section className="panel" aria-label="Jobs"><h2>Jobs</h2><ul>{jobs.map((job) => <li key={job.id}><strong>{job.modelId}: {job.status}</strong> — {jobStatusDetail(job.status)} {job.outputUrl ? <a href={job.outputUrl}>Open video</a> : null} {job.errorMessage ? `— ${job.errorMessage}` : null}</li>)}</ul></section> : null}
    </section>
  );
}
