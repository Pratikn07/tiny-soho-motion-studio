"use client";

import { useCallback, useEffect, useState } from "react";

import type { ReelIdea, ReelJobView, ReelStep, ReelSummary, ReelView } from "@/lib/reels";
import type { MacState } from "@/components/shell/ShellBar";
import type { ReelsApi } from "./api";
import r from "./reels.module.css";

const STEPS: Array<{ id: ReelStep; label: string }> = [
  { id: "idea", label: "Idea" }, { id: "script", label: "Script" }, { id: "storyboard", label: "Storyboard" },
  { id: "voice", label: "Voice" }, { id: "images", label: "Images" }, { id: "build", label: "Build" },
  { id: "sound", label: "Sound" }, { id: "export", label: "Export" },
];
const BUILT: ReelStep[] = ["idea", "script"];
const POLL_MS = 4000;

const active = (job?: ReelJobView) => job?.status === "queued" || job?.status === "running";

/** The Reels section: start a reel from a topic, then work through its steps with the Studio Mac. */
export function ReelsStudio({ api, macState }: { api: ReelsApi; macState: MacState }) {
  const [reels, setReels] = useState<ReelSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const refreshList = useCallback(() => api.list().then(setReels).catch((error: Error) => setNotice(error.message)), [api]);
  useEffect(() => { void refreshList(); }, [refreshList]);

  if (openId) return <ReelWorkspace api={api} id={openId} macState={macState} onBack={() => { setOpenId(null); void refreshList(); }} />;
  return (
    <div className={r.home}>
      <div>
        <h1 className={r.title}>Reels</h1>
        <p className={r.lede}>Start from a topic. The Studio Mac drafts each step and you approve it before the next one starts.</p>
      </div>
      <NewReel api={api} onCreated={(reel) => setOpenId(reel.id)} onError={setNotice} />
      {notice && <p className={r.error} role="alert">{notice}</p>}
      <section aria-labelledby="your-reels">
        <h2 id="your-reels" className={r.subtitle}>Your reels</h2>
        {reels === null ? <p className={r.muted}>Loading your reels…</p>
          : reels.length === 0 ? <p className={r.muted}>No reels yet. Your first one starts above.</p>
            : <ul className={r.list}>{reels.map((reel) => (
              <li key={reel.id}><button type="button" className={r.reelRow} onClick={() => setOpenId(reel.id)}>
                <b>{reel.title}</b><span>{STEPS.find((step) => step.id === reel.currentStep)?.label ?? reel.currentStep}</span>
              </button></li>
            ))}</ul>}
      </section>
    </div>
  );
}

function NewReel({ api, onCreated, onError }: { api: ReelsApi; onCreated: (reel: ReelView) => void; onError: (message: string) => void }) {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className={r.newReel} onSubmit={(event) => {
      event.preventDefault();
      setBusy(true);
      onError("");
      api.create(topic.trim()).then(onCreated).catch((error: Error) => onError(error.message)).finally(() => setBusy(false));
    }}>
      <label htmlFor="reel-topic" className={r.label}>What should this reel be about?</label>
      <textarea id="reel-topic" className={r.field} value={topic} maxLength={400} rows={2}
        placeholder="For example: Halloween meltdowns, bedtime stalling, the clock change" onChange={(event) => setTopic(event.target.value)} />
      <div><button type="submit" className={r.primary} disabled={busy}>{busy ? "Starting…" : "Start a reel"}</button></div>
    </form>
  );
}

function ReelWorkspace({ api, id, macState, onBack }: { api: ReelsApi; id: string; macState: MacState; onBack: () => void }) {
  const [reel, setReel] = useState<ReelView | null>(null);
  const [step, setStep] = useState<ReelStep | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => api.get(id).then((next) => { setReel(next); setNotice(""); }).catch((error: Error) => setNotice(error.message)), [api, id]);
  useEffect(() => { void load(); }, [load]);
  const busy = reel ? Object.values(reel.jobs).some(active) : false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, load]);
  const act = (action: Parameters<ReelsApi["act"]>[1]) =>
    api.act(id, action).then((next) => { setReel(next); setStep(next.currentStep); }).catch((error: Error) => setNotice(error.message));

  if (!reel) return <div className={r.home}><button type="button" className={r.link} onClick={onBack}>All reels</button><p className={r.muted}>{notice || "Opening the reel…"}</p></div>;
  const shown = step ?? reel.currentStep;
  const reached = STEPS.findIndex((item) => item.id === reel.currentStep);
  return (
    <div className={r.work}>
      <nav className={r.rail} aria-label="Reel steps">
        <button type="button" className={r.link} onClick={onBack}>All reels</button>
        <h2 className={r.reelTitle}>{reel.title}</h2>
        <ol className={r.steps}>
          {STEPS.map((item, index) => {
            const done = index < reached;
            const state = done ? "Done" : index === reached ? (active(reel.jobs[item.id]) ? "Working" : "Now") : BUILT.includes(item.id) ? "Next" : "Soon";
            return (
              <li key={item.id}>
                <button type="button" className={r.step} aria-current={item.id === shown ? "step" : undefined}
                  disabled={index > reached} onClick={() => setStep(item.id)}>
                  <span className={r.stepNo}>{String(index + 1).padStart(2, "0")}</span>
                  <span>{item.label}</span>
                  <span className={`${r.badge} ${done ? r.badgeDone : index === reached ? r.badgeNow : r.badgeSoon}`}>{state}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <section className={r.stage} aria-label={`${STEPS.find((item) => item.id === shown)?.label} step`}>
        {notice && <p className={r.error} role="alert">{notice}</p>}
        {shown === "idea" && <IdeaStep reel={reel} macState={macState} onChoose={(idea) => void act({ action: "choose_idea", idea })} onRetry={() => void act({ action: "retry" })} />}
        {shown === "script" && <ScriptStep reel={reel} macState={macState} onRevise={(comments) => act({ action: "revise_script", comments })}
          onApprove={() => void act({ action: "approve_script" })} onRetry={() => void act({ action: "retry" })} />}
        {!BUILT.includes(shown) && (
          <div className={r.panel}>
            <h1 className={r.title}>{STEPS.find((item) => item.id === shown)?.label}</h1>
            <p className={r.lede}>This step is being built next. Your approved script is saved and will carry straight into it.</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** Where a step's job is: waiting for the Mac, working, failed, or ready. */
function JobState({ job, macState, onRetry }: { job?: ReelJobView; macState: MacState; onRetry: () => void }) {
  if (!job) return null;
  if (job.status === "queued") {
    return <p className={r.status} role="status">{macState === "online" ? "Queued. The Studio Mac will start it in a moment." : "Waiting for the Studio Mac. It starts as soon as your Mac is awake and online."}</p>;
  }
  if (job.status === "running") return <p className={r.status} role="status" aria-busy="true">{job.progress ?? "The Studio Mac is working on this step."}</p>;
  if (job.status === "failed") {
    return <div className={r.failed} role="alert"><p>{job.progress ?? "This step didn't finish."} ({job.errorCode ?? "error"})</p><button type="button" className={r.secondary} onClick={onRetry}>Try again</button></div>;
  }
  return null;
}

function IdeaStep({ reel, macState, onChoose, onRetry }: { reel: ReelView; macState: MacState; onChoose: (idea: ReelIdea) => void; onRetry: () => void }) {
  const job = reel.jobs.idea;
  const ideas = (job?.result?.ideas as ReelIdea[] | undefined) ?? [];
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 01 · Idea</span>
        <h1 className={r.title}>Pick the story</h1>
        <p className={r.lede}>{reel.document.topic ? `Topic: ${reel.document.topic}` : "Three ideas for a 20–30 second story reel."}</p>
      </div>
      <JobState job={job} macState={macState} onRetry={onRetry} />
      {ideas.length > 0 && (
        <div className={r.ideas}>
          {ideas.map((idea) => {
            const chosen = reel.document.idea?.title === idea.title;
            return (
              <article key={idea.title} className={`${r.idea} ${chosen ? r.chosen : ""}`}>
                <h2>{idea.title}</h2>
                <p className={r.hook}>“{idea.hook}”</p>
                <p className={r.muted}>{idea.why}</p>
                <button type="button" className={chosen ? r.secondary : r.primary} onClick={() => onChoose(idea)}>{chosen ? "Chosen · use again" : "Use this idea"}</button>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function ScriptStep({ reel, macState, onRevise, onApprove, onRetry }: {
  reel: ReelView; macState: MacState; onRevise: (comments: string) => Promise<unknown>; onApprove: () => void; onRetry: () => void;
}) {
  const [comments, setComments] = useState("");
  const job = reel.jobs.script;
  const script = reel.document.script;
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 02 · Script</span>
        <h1 className={r.title}>{script?.approved ? "Script approved" : "Approve the script"}</h1>
        {reel.document.idea && <p className={r.lede}>{reel.document.idea.title}: “{reel.document.idea.hook}”</p>}
      </div>
      <JobState job={job} macState={macState} onRetry={onRetry} />
      {script && (
        <div className={r.tableWrap}>
          <table className={r.table}>
            <thead><tr><th>Time</th><th>Voice</th><th>On screen</th></tr></thead>
            <tbody>{script.lines.map((line, index) => (
              <tr key={index}><td className={r.time}>{line.time}</td><td>{line.voice}</td><td>{line.onScreen}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {script?.notes && <p className={r.note}>{script.notes}</p>}
      {script && !script.approved && !active(job) && (
        <div className={r.actions}>
          <label htmlFor="script-changes" className={r.label}>Ask for changes</label>
          <textarea id="script-changes" className={r.field} rows={2} value={comments} maxLength={1000}
            placeholder="For example: make the hook shorter, or end on a softer line" onChange={(event) => setComments(event.target.value)} />
          <div className={r.buttons}>
            <button type="button" className={r.secondary} disabled={!comments.trim()} onClick={() => { void onRevise(comments.trim()).then(() => setComments("")); }}>Send changes</button>
            <button type="button" className={r.primary} onClick={onApprove}>Approve script</button>
          </div>
        </div>
      )}
      {script?.approved && <p className={r.status}>Approved. The storyboard step comes next.</p>}
    </>
  );
}
