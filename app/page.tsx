"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";

type Project = { id: string; name: string };
type Asset = { id: string; name: string; mime: string; width?: number; height?: number; duration?: number | null; reusableProviderOutput?: boolean };
type Job = { id: string; status: string; prompt: string; modelId: string; outputAssetId?: string; error?: string; createdAt: string };
type MediaRole = "source-image" | "start-image" | "end-image" | "reference-image" | "reference-video" | "reference-audio" | "driving-audio" | "first-clip";
type Model = {
  id: string; label: string; media: "image" | "video"; eligible: boolean; disabledReason?: string | null;
  mediaRules: { allowedRoles: MediaRole[]; maxByRole: Partial<Record<MediaRole, number>> };
  duration?: { min: number; max: number; smartValue?: -1 };
  resolutions?: string[]; aspectRatios?: string[]; defaultOptions: Record<string, string | number | boolean>;
};
type SettingsStatus = { creativeKnowledgeConfigured: boolean; freeQuotaModels: string[] };
type TransportMedia = { role: MediaRole | "reference-voice" | "existing-public-url"; available: boolean; reason: string | null };
type Transport = { transport: { state: "unavailable" | "probe-required" | "verified"; reason?: string }; models: Array<{ modelId: string; media: TransportMedia[] }> };
type DraftMedia = { assetId: string; role: MediaRole; publicUrl?: string; referenceVoiceAssetId?: string; referenceVoicePublicUrl?: string };

const emptyTransport: Transport = { transport: { state: "probe-required", reason: "Checking local media transport…" }, models: [] };
const inlineRoles = new Set<MediaRole>(["source-image", "start-image", "end-image", "reference-image"]);
const roleName = (role: string) => role.replaceAll("-", " ");
const hasRole = (model: Model | undefined, role: MediaRole) => Boolean(model?.mediaRules.allowedRoles.includes(role));

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function selectedIds(event: ChangeEvent<HTMLSelectElement>, maximum?: number) {
  return [...event.target.selectedOptions].map((option) => option.value).filter(Boolean).slice(0, maximum || undefined);
}

function AssetPicker({ label, assets, values, setValues, maximum, multiple = false }: { label: string; assets: Asset[]; values: string[]; setValues: (ids: string[]) => void; maximum?: number; multiple?: boolean }) {
  return <label>{label}
    <select className={multiple ? "multi-asset-select" : ""} multiple={multiple} value={multiple ? values : values[0] || ""} onChange={(event) => setValues(selectedIds(event, multiple ? maximum : 1))}>
      {!multiple && <option value="">None</option>}
      {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.reusableProviderOutput ? " · reusable output" : ""}</option>)}
    </select>
    {multiple && <small className="muted">Select up to {maximum || "the model limit"} assets.</small>}
  </label>;
}

function UrlFields({ values, assets, urls, setUrl, reason }: { values: string[]; assets: Asset[]; urls: Record<string, string>; setUrl: (assetId: string, url: string) => void; reason: string }) {
  if (!values.length) return null;
  return <div className="url-media">
    <p className="transport-hint">{reason}</p>
    {values.map((assetId) => <label key={assetId}>EXISTING PUBLIC HTTPS URL FOR {assets.find((asset) => asset.id === assetId)?.name || "selected media"}
      <input type="url" value={urls[assetId] || ""} onChange={(event) => setUrl(assetId, event.target.value)} placeholder="https://public.example/media" />
      <small className="muted">Use only a query-free public URL. It is optional for a reusable provider output.</small>
    </label>)}
  </div>;
}

export default function Studio() {
  const [tab, setTab] = useState("motion");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [settings, setSettings] = useState<SettingsStatus>({ creativeKnowledgeConfigured: false, freeQuotaModels: [] });
  const [selectedQuotaModels, setSelectedQuotaModels] = useState<string[]>([]);
  const [transport, setTransport] = useState<Transport>(emptyTransport);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notice, setNotice] = useState("Loading local studio…");
  const [modelId, setModelId] = useState("alibaba:wan2.7-i2v");
  const [prompt, setPrompt] = useState("A quiet, luminous product scene with subtle movement");
  const [source, setSource] = useState("");
  const [end, setEnd] = useState("");
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceVideos, setReferenceVideos] = useState<string[]>([]);
  const [referenceAudio, setReferenceAudio] = useState<string[]>([]);
  const [drivingAudio, setDrivingAudio] = useState("");
  const [firstClip, setFirstClip] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [voices, setVoices] = useState<Record<string, string>>({});
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({});
  const [duration, setDuration] = useState("5");
  const [resolution, setResolution] = useState("720P");
  const [ratio, setRatio] = useState("adaptive");
  const active = models.find((model) => model.id === modelId);
  const images = assets.filter((asset) => asset.mime.startsWith("image/"));
  const videos = assets.filter((asset) => asset.mime.startsWith("video/"));
  const audio = assets.filter((asset) => asset.mime.startsWith("audio/"));

  const refresh = async () => {
    try {
      const [projectList, modelList, status, transportState] = await Promise.all([
        api<Project[]>("/api/projects"), api<Model[]>("/api/models"), api<SettingsStatus>("/api/settings/status"), api<Transport>("/api/media-transport/capabilities"),
      ]);
      setProjects(projectList); setModels(modelList); setSettings(status); setTransport(transportState);
      const chosen = projectId || projectList[0]?.id || "";
      if (chosen && chosen !== projectId) setProjectId(chosen);
      if (chosen) {
        const [library, history] = await Promise.all([api<Asset[]>("/api/assets?projectId=" + chosen), api<Job[]>("/api/jobs?projectId=" + chosen)]);
        setAssets(library); setJobs(history);
      }
      setNotice("Local studio ready.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load studio.");
    }
  };
  useEffect(() => { void refresh(); }, [projectId]);
  useEffect(() => { setSelectedQuotaModels(settings.freeQuotaModels); }, [settings.freeQuotaModels.join("|")]);

  const clearMedia = () => {
    setSource(""); setEnd(""); setReferenceImages([]); setReferenceVideos([]); setReferenceAudio([]); setDrivingAudio(""); setFirstClip("");
    setUrls({}); setVoices({}); setVoiceUrls({});
  };
  const selectModel = (id: string) => {
    const model = models.find((entry) => entry.id === id);
    setModelId(id); clearMedia();
    if (model) { setDuration(String(model.defaultOptions.duration || "")); setResolution(String(model.defaultOptions.resolution || "")); setRatio(String(model.defaultOptions.aspectRatio || "")); }
  };

  const media = useMemo(() => {
    if (!active) return [];
    const url = (assetId: string) => urls[assetId]?.trim() || undefined;
    const voiceUrl = (assetId: string) => voiceUrls[assetId]?.trim() || undefined;
    const refs = (ids: string[], role: MediaRole, includeVoice = false): DraftMedia[] => ids.map((assetId) => ({
      assetId, role, ...(url(assetId) ? { publicUrl: url(assetId) } : {}),
      ...(includeVoice && voices[assetId] ? { referenceVoiceAssetId: voices[assetId] } : {}),
      ...(includeVoice && voiceUrl(assetId) ? { referenceVoicePublicUrl: voiceUrl(assetId) } : {}),
    }));
    const result: DraftMedia[] = [];
    if (source) result.push({ assetId: source, role: active.media === "image" ? "source-image" : "start-image" });
    if (end) result.push({ assetId: end, role: "end-image" });
    result.push(...refs(referenceImages, "reference-image", true), ...refs(referenceVideos, "reference-video", true), ...refs(referenceAudio, "reference-audio"));
    if (drivingAudio) result.push({ assetId: drivingAudio, role: "driving-audio", ...(url(drivingAudio) ? { publicUrl: url(drivingAudio) } : {}) });
    if (firstClip) result.push({ assetId: firstClip, role: "first-clip", ...(url(firstClip) ? { publicUrl: url(firstClip) } : {}) });
    return result;
  }, [active, source, end, referenceImages, referenceVideos, referenceAudio, drivingAudio, firstClip, urls, voices, voiceUrls]);

  const selectedModelTransport = transport.models.find((entry) => entry.modelId === active?.id);
  const transportReason = (role: TransportMedia["role"]) => selectedModelTransport?.media.find((entry) => entry.role === role)?.reason || transport.transport.reason || "Local URL transport is unavailable.";
  const available = (role: TransportMedia["role"]) => Boolean(selectedModelTransport?.media.find((entry) => entry.role === role)?.available);
  const asset = (assetId: string) => assets.find((entry) => entry.id === assetId);
  const blockers = media.flatMap((item) => {
    const blocked: string[] = [];
    if (!inlineRoles.has(item.role) && !item.publicUrl && !asset(item.assetId)?.reusableProviderOutput && !available(item.role)) blocked.push(roleName(item.role) + ": " + transportReason(item.role));
    if (item.referenceVoiceAssetId && !item.referenceVoicePublicUrl && !asset(item.referenceVoiceAssetId)?.reusableProviderOutput && !available("reference-voice")) blocked.push("reference voice: " + transportReason("reference-voice"));
    return blocked;
  }).filter((value, index, all) => all.indexOf(value) === index);
  const canSubmit = Boolean(active?.eligible) && blockers.length === 0;
  const setUrl = (assetId: string, value: string) => setUrls({ ...urls, [assetId]: value });

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("file");
    if (!(file instanceof File) || !projectId) return;
    const form = new FormData(); form.set("file", file); form.set("projectId", projectId); form.set("kind", "layer");
    const response = await fetch("/api/assets", { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) return setNotice(body.error || "Upload failed.");
    setSource(body.id); event.currentTarget.reset(); setNotice("Saved " + body.name + " locally."); await refresh();
  };
  const createProject = async () => {
    const name = window.prompt("Project name", "Tiny Soho motion project");
    if (!name) return;
    try { const project = await api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }); setProjectId(project.id); } catch (error) { setNotice(error instanceof Error ? error.message : "Project could not be created."); }
  };
  const submit = async () => {
    if (!projectId || !active) return setNotice("Create a project and select a model first.");
    if (blockers.length) return setNotice("Resolve selected media transport before queueing.");
    const options: Record<string, unknown> = { promptExtend: true, watermark: false };
    if (active.duration) options.duration = Number(duration);
    if (active.resolutions) options.resolution = resolution;
    if (active.aspectRatios) options.aspectRatio = ratio;
    try {
      const job = await api<Job>("/api/jobs", { method: "POST", body: JSON.stringify({ projectId, idempotencyKey: crypto.randomUUID(), modelId: active.id, prompt, media, options }) });
      setNotice("Queued " + job.id.slice(-8) + ". The worker still requires Free Quota confirmation."); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Generation could not be queued."); }
  };
  const saveQuotaModels = async () => {
    try {
      await api("/api/settings/status", { method: "POST", body: JSON.stringify({ freeQuotaModels: selectedQuotaModels }) });
      setNotice("Saved explicit Free Quota Only confirmations.");
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Free Quota confirmation could not be saved."); }
  };
  const videoModels = models.filter((model) => model.media === "video");
  const shownModels = tab === "image" ? models.filter((model) => model.media === "image") : videoModels;
  const changeTab = (next: string) => {
    setTab(next);
    const choices = next === "image" ? models.filter((model) => model.media === "image") : ["motion", "video", "cinema"].includes(next) ? videoModels : [];
    if (choices.length && !choices.some((model) => model.id === modelId)) selectModel(choices[0].id);
  };

  return <main>
    <aside>
      <div className="brand"><span>◎</span> Tiny Soho<small>CREATIVE STUDIO</small></div>
      <button className="new" onClick={createProject}>＋ New project</button>
      {["motion", "image", "video", "cinema", "assets", "workflows", "director", "vision", "settings"].map((name) => <button key={name} className={tab === name ? "nav active" : "nav"} onClick={() => changeTab(name)}>{name === "motion" ? "✦ Tiny Soho Motion" : name === "vision" ? "◌ Vision Lab" : name[0].toUpperCase() + name.slice(1)}</button>)}
      <div className="project-select"><label>PROJECT<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Choose a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div>
    </aside>
    <section className="workspace">
      <header><div><p className="eyebrow">LOCAL · SINGAPORE · FREE QUOTA ONLY</p><h1>{tab === "motion" ? "Typography-safe motion" : tab[0].toUpperCase() + tab.slice(1)}</h1></div><span className="notice">{notice}</span></header>
      {tab === "assets" ? <div className="panel"><h2>Layer library</h2><form className="upload" onSubmit={upload}><input name="file" type="file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,video/mp4,video/quicktime" required /><button className="primary">Save locally</button></form><div className="asset-grid">{assets.map((item) => <article key={item.id}><div className="thumb">{item.mime.startsWith("image/") ? <img src={"/api/assets/" + item.id + "/content"} alt="" /> : item.mime.startsWith("video/") ? "▸" : "♫"}</div><b>{item.name}</b><small>{item.width ? item.width + "×" + item.height : item.duration ? item.duration + " seconds" : item.mime}</small>{item.reusableProviderOutput && <small className="ok">Reusable provider output</small>}</article>)}</div></div> :
        tab === "settings" ? <div className="panel settings"><h2>Provider safety</h2><p>Check only models for which you enabled Alibaba’s Free Quota Only guard. The app never chooses a paid fallback.</p><div className="model-list">{models.map((model) => <label key={model.id}><input type="checkbox" checked={selectedQuotaModels.includes(model.id)} onChange={() => setSelectedQuotaModels(selectedQuotaModels.includes(model.id) ? selectedQuotaModels.filter((id) => id !== model.id) : [...selectedQuotaModels, model.id])} /> <b>{model.label}</b><span className={selectedQuotaModels.includes(model.id) ? "ok" : "warn"}>{selectedQuotaModels.includes(model.id) ? "Confirmed" : "Blocked"}</span></label>)}</div><button className="primary" onClick={() => void saveQuotaModels()}>Save confirmed models</button><p className={settings.creativeKnowledgeConfigured ? "ok" : "warn"}>Creative knowledge: {settings.creativeKnowledgeConfigured ? "configured" : "not configured"}</p></div> :
          tab === "workflows" ? <Directory title="Workflow Studio" description="Build and run persisted local graphs with explicit asset edges and checkpoints." href="/workflows" action="Open workflow builder" /> :
            tab === "director" ? <Directory title="AI Director" description="Draft a structured proposal, review its exact media choices, then approve it once." href="/director" action="Open AI Director" /> :
              tab === "vision" ? <Directory title="Experimental Vision Lab" description="Analyze local vision results, protect original typography, and queue one guarded motion clip." href="/vision-lab" action="Open Vision Lab" /> :
                <div className="generator">
                  <div className="panel compose">
                    <div className="mode">{tab === "motion" ? "Clean background in · original typography back on top" : tab + " studio"}</div>
                    <div className={"transport-state " + transport.transport.state}><b>Local URL media: {transport.transport.state}</b><span>{transport.transport.reason || "Verified for the selected model."}</span></div>
                    <label>MODEL<select value={active?.id || ""} onChange={(event) => selectModel(event.target.value)}>{shownModels.map((model) => <option key={model.id} value={model.id}>{model.label}{model.eligible ? "" : " — blocked"}</option>)}</select></label>
                    <label>PROMPT<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
                    {(active?.media === "image" || hasRole(active, "start-image")) && <AssetPicker label={active?.media === "image" ? "SOURCE IMAGE OPTIONAL" : "START FRAME OPTIONAL"} assets={images} values={source ? [source] : []} setValues={(ids) => setSource(ids[0] || "")} />}
                    {hasRole(active, "end-image") && <AssetPicker label="END FRAME OPTIONAL" assets={images} values={end ? [end] : []} setValues={(ids) => setEnd(ids[0] || "")} />}
                    {hasRole(active, "reference-image") && <AssetPicker label="REFERENCE IMAGES" assets={images} values={referenceImages} setValues={setReferenceImages} multiple maximum={active?.mediaRules.maxByRole["reference-image"]} />}
                    {hasRole(active, "reference-video") && <><AssetPicker label="REFERENCE VIDEOS" assets={videos} values={referenceVideos} setValues={setReferenceVideos} multiple maximum={active?.mediaRules.maxByRole["reference-video"]} /><UrlFields values={referenceVideos} assets={videos} urls={urls} setUrl={setUrl} reason={"Local reference video: " + transportReason("reference-video")} /></>}
                    {hasRole(active, "reference-audio") && <><AssetPicker label="REFERENCE AUDIO" assets={audio} values={referenceAudio} setValues={setReferenceAudio} multiple maximum={active?.mediaRules.maxByRole["reference-audio"]} /><UrlFields values={referenceAudio} assets={audio} urls={urls} setUrl={setUrl} reason={"Local reference audio: " + transportReason("reference-audio")} /></>}
                    {hasRole(active, "driving-audio") && <><AssetPicker label="DRIVING AUDIO" assets={audio} values={drivingAudio ? [drivingAudio] : []} setValues={(ids) => setDrivingAudio(ids[0] || "")} /><UrlFields values={drivingAudio ? [drivingAudio] : []} assets={audio} urls={urls} setUrl={setUrl} reason={"Local driving audio: " + transportReason("driving-audio")} /></>}
                    {hasRole(active, "first-clip") && <><AssetPicker label="FIRST CLIP" assets={videos} values={firstClip ? [firstClip] : []} setValues={(ids) => setFirstClip(ids[0] || "")} /><UrlFields values={firstClip ? [firstClip] : []} assets={videos} urls={urls} setUrl={setUrl} reason={"Local first clip: " + transportReason("first-clip")} /></>}
                    {active?.id === "alibaba:wan2.7-r2v" && [...referenceImages, ...referenceVideos].map((referenceId) => <div key={referenceId} className="voice-row"><AssetPicker label={"REFERENCE VOICE FOR " + referenceId.slice(-8)} assets={audio} values={voices[referenceId] ? [voices[referenceId]] : []} setValues={(ids) => setVoices({ ...voices, [referenceId]: ids[0] || "" })} />{voices[referenceId] && <label>EXISTING PUBLIC HTTPS VOICE URL<input type="url" value={voiceUrls[referenceId] || ""} onChange={(event) => setVoiceUrls({ ...voiceUrls, [referenceId]: event.target.value })} placeholder="https://public.example/voice.mp3" /></label>}</div>)}
                    {active?.duration && <label>DURATION<select value={duration} onChange={(event) => setDuration(event.target.value)}>{active.duration.smartValue && <option value="-1">Smart duration</option>}{Array.from({ length: active.duration.max - active.duration.min + 1 }, (_, index) => active.duration!.min + index).map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>}
                    {active?.resolutions && <label>RESOLUTION<select value={resolution} onChange={(event) => setResolution(event.target.value)}>{active.resolutions.map((value) => <option key={value}>{value}</option>)}</select></label>}
                    {active?.aspectRatios && <label>ASPECT RATIO<select value={ratio} onChange={(event) => setRatio(event.target.value)}>{active.aspectRatios.map((value) => <option key={value}>{value}</option>)}</select></label>}
                    <div className="presets"><button onClick={() => setPrompt(prompt + ". Locked camera, text-safe central negative space.")}>Locked</button><button onClick={() => setPrompt(prompt + ". Slow push-in, natural ambient movement.")}>Slow push-in</button><button onClick={() => setPrompt(prompt + ". Gentle lateral pan, soft daylight.")}>Gentle pan</button></div>
                    {!!blockers.length && <div className="transport-blockers"><b>Selected media cannot be queued yet</b>{blockers.map((blocker) => <span key={blocker}>{blocker}</span>)}<small>Select a reusable provider output or add a query-free public HTTPS URL.</small></div>}
                    <button className="primary generate" disabled={!canSubmit} onClick={() => void submit()}>{!active?.eligible ? "Confirm Free Quota Only in Settings" : blockers.length ? "Resolve media transport first" : "Generate after review →"}</button>
                    {active?.disabledReason && <p className="muted">{active.disabledReason}</p>}
                  </div>
                  <div className="panel history"><h2>Job history</h2>{jobs.map((job) => <article key={job.id}><span className={"status " + job.status}>{job.status}</span><p>{job.prompt}</p><small>{job.modelId} · {new Date(job.createdAt).toLocaleString()}</small>{job.outputAssetId && <a href={"/api/assets/" + job.outputAssetId + "/content"} target="_blank">Open local result</a>}{job.error && <em>{job.error}</em>}</article>)}{!jobs.length && <p className="muted">No jobs yet. Jobs persist through browser refreshes and worker restarts.</p>}</div>
                </div>}
    </section>
  </main>;
}

function Directory({ title, description, href, action }: { title: string; description: string; href: string; action: string }) {
  return <div className="panel"><h2>{title}</h2><p>{description}</p><a className="primary" href={href}>{action}</a></div>;
}
