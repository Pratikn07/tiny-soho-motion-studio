"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import { briefIsUsable, parseBrief, type ReelBrief } from "@/lib/reel-brief";
import type { ReelIdea, ReelStep, ReelSummary, ReelView } from "@/lib/reels";
import type { MacState } from "@/components/shell/ShellBar";
import type { NewReelInput, ReelsApi } from "./api";
import { active, CopyButton, JobState } from "./job-state";
import { ImagesStep } from "./images";
import { BuildStep } from "./build";
import { ExportStep, SoundStep } from "./sound";
import { StoryboardStep } from "./storyboard";
import { VoiceStep } from "./voice";
import r from "./reels.module.css";

const STEPS: Array<{ id: ReelStep; label: string }> = [
  { id: "idea", label: "Idea" }, { id: "script", label: "Script" }, { id: "storyboard", label: "Storyboard" },
  { id: "images", label: "Images" }, { id: "voice", label: "Voice" }, { id: "build", label: "Build" },
  { id: "sound", label: "Sound" }, { id: "export", label: "Export" },
];
const BUILT: ReelStep[] = ["idea", "script", "storyboard", "images", "voice", "build", "sound", "export"];
const POLL_MS = 4000;

/** The Reels section: start a reel from a brief, a reference reel or a topic, then work through its steps with the Studio Mac. */
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
        <p className={r.lede}>Paste a brief from the Claude project, learn from a reel you liked, or start from a topic. The Studio Mac drafts each step and you approve it before the next one starts.</p>
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

type Source = "brief" | "reference" | "topic";
const SOURCES: Array<{ id: Source; label: string }> = [
  { id: "brief", label: "Paste a brief" }, { id: "reference", label: "Reference reel" }, { id: "topic", label: "Just a topic" },
];

/** What Studio read from a pasted brief, so a mistake shows before the reel starts. */
function BriefPreview({ brief }: { brief: ReelBrief | null }) {
  if (!brief) return null;
  if (!briefIsUsable(brief)) return <p className={r.error}>Studio can't find a HOOK, an ANGLE or a SCRIPT DRAFT in this text yet.</p>;
  const found = [brief.title && `“${brief.title}”`, brief.series && `series ${brief.series}`, brief.treatment && "a treatment",
    brief.scriptDraft?.length && `${brief.scriptDraft.length} script line${brief.scriptDraft.length === 1 ? "" : "s"}`, brief.facts?.length && `${brief.facts.length} fact${brief.facts.length === 1 ? "" : "s"}`].filter(Boolean);
  return (
    <p className={r.muted} role="status">
      Read: {found.join(" · ") || "a hook and an angle"}.{" "}
      {brief.scriptDraft?.length ? "Your script will be kept, timed and checked." : "The Studio Mac will write the script from it."}
    </p>
  );
}

function NewReel({ api, onCreated, onError }: { api: ReelsApi; onCreated: (reel: ReelView) => void; onError: (message: string) => void }) {
  const [source, setSource] = useState<Source>("brief");
  const [topic, setTopic] = useState("");
  const [briefText, setBriefText] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const brief = briefText.trim() ? parseBrief(briefText) : null;
  const ready = source === "topic" || (source === "brief" ? Boolean(brief && briefIsUsable(brief)) : /^https?:\/\/\S+$/.test(link.trim()));
  const input: NewReelInput = source === "brief" ? { brief: briefText.trim() } : source === "reference" ? { reference: link.trim() } : { topic: topic.trim() };
  return (
    <form className={r.newReel} onSubmit={(event) => {
      event.preventDefault();
      setBusy(true);
      onError("");
      api.create(input).then(onCreated).catch((error: Error) => onError(error.message)).finally(() => setBusy(false));
    }}>
      <div className={r.tabs} role="radiogroup" aria-label="Start from">
        {SOURCES.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={source === item.id} className={r.tab} onClick={() => setSource(item.id)}>{item.label}</button>
        ))}
      </div>
      {source === "brief" && (
        <>
          <label htmlFor="reel-brief" className={r.label}>Paste your brief</label>
          <textarea id="reel-brief" className={r.field} value={briefText} maxLength={8000} rows={10}
            placeholder={"In the Claude project, say “write the brief” and paste the block here.\nTITLE: ...\nHOOK: ...\nANGLE: ..."}
            onChange={(event) => setBriefText(event.target.value)} />
          <BriefPreview brief={brief} />
        </>
      )}
      {source === "reference" && (
        <>
          <label htmlFor="reel-reference" className={r.label}>Link to the reel</label>
          <input id="reel-reference" className={r.field} type="url" value={link} placeholder="https://www.instagram.com/reel/..." onChange={(event) => setLink(event.target.value)} />
          <p className={r.muted}>The Studio Mac watches it (frames, cuts and the voice) and sends back what makes it work, what to borrow, what not to copy, and three Tiny Soho angles.</p>
        </>
      )}
      {source === "topic" && (
        <>
          <label htmlFor="reel-topic" className={r.label}>What should this reel be about?</label>
          <textarea id="reel-topic" className={r.field} value={topic} maxLength={400} rows={2}
            placeholder="For example: Halloween meltdowns, bedtime stalling, the clock change" onChange={(event) => setTopic(event.target.value)} />
        </>
      )}
      <div><button type="submit" className={r.primary} disabled={busy || !ready}>{busy ? "Starting…" : "Start a reel"}</button></div>
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
        {shown === "storyboard" && <StoryboardStep reel={reel} macState={macState} act={act} onRetry={() => void act({ action: "retry" })} />}
        {shown === "sound" && <SoundStep reel={reel} macState={macState} act={act} onRetry={() => void act({ action: "retry" })} />}
        {shown === "export" && <ExportStep reel={reel} macState={macState} act={act} onRetry={() => void act({ action: "retry" })} />}
        {shown === "build" && <BuildStep reel={reel} macState={macState} act={act} onRetry={() => void act({ action: "retry" })} />}
        {shown === "voice" && <VoiceStep reel={reel} macState={macState} act={act} onRetry={() => void act({ action: "retry" })} />}
        {shown === "images" && <ImagesStep reel={reel} api={api} act={act} onReel={(next) => setReel(next)} macState={macState} />}
        {!BUILT.includes(shown) && (
          <div className={r.panel}>
            <h1 className={r.title}>{STEPS.find((item) => item.id === shown)?.label}</h1>
            <p className={r.lede}>This step is being built next. Your approved build is saved and will carry straight into it.</p>
          </div>
        )}
      </section>
    </div>
  );
}

type Breakdown = {
  url: string; seconds: number; cuts: number; summary: string; hook: string; hookSeconds: number | null; pacing: string;
  structure: string; textStyle: string; emotion: string; works: string[]; borrow: string[]; avoid: string[]; transcript: string;
};

/** The breakdown as text to paste into the Claude project chat. */
function breakdownText(b: Breakdown) {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  return [`REFERENCE BREAKDOWN (${b.url}, ${b.seconds}s, ${b.cuts} cuts)`, `Summary: ${b.summary}`,
    `Hook: ${b.hook}${b.hookSeconds ? ` (lands at ${b.hookSeconds}s)` : ""}`, `Pacing: ${b.pacing}`, `Structure: ${b.structure}`,
    `Text style: ${b.textStyle}`, `Emotion: ${b.emotion}`, `What works:\n${list(b.works)}`, `Borrow:\n${list(b.borrow)}`,
    `Don't copy:\n${list(b.avoid)}`, b.transcript ? `Transcript: ${b.transcript}` : ""].filter(Boolean).join("\n");
}

function BreakdownCard({ breakdown }: { breakdown: Breakdown }) {
  return (
    <section className={r.card} aria-labelledby="breakdown-title">
      <div className={r.summary}>
        <h2 id="breakdown-title" className={r.subtitle}>What makes it work</h2>
        <CopyButton text={breakdownText(breakdown)} label="Copy for Claude" />
      </div>
      <p className={r.muted}>{breakdown.seconds}s · {breakdown.cuts} cuts · <a href={breakdown.url} target="_blank" rel="noreferrer">open the reel</a></p>
      <p>{breakdown.summary}</p>
      <dl className={r.facts}>
        <dt>Hook</dt><dd>{breakdown.hook}{breakdown.hookSeconds ? ` (lands at ${breakdown.hookSeconds}s)` : ""}</dd>
        <dt>Pacing</dt><dd>{breakdown.pacing}</dd>
        <dt>Structure</dt><dd>{breakdown.structure}</dd>
        <dt>Text style</dt><dd>{breakdown.textStyle}</dd>
        <dt>Emotion</dt><dd>{breakdown.emotion}</dd>
      </dl>
      <div className={r.columns}>
        <div><h3 className={r.label}>Why it works</h3><ul>{breakdown.works.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3 className={r.label}>Borrow</h3><ul>{breakdown.borrow.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3 className={r.label}>Don't copy</h3><ul>{breakdown.avoid.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
      {breakdown.transcript && <details><summary className={r.label}>Transcript</summary><p className={r.muted}>{breakdown.transcript}</p></details>}
    </section>
  );
}

function BriefCard({ brief }: { brief: ReelBrief }) {
  const rows: Array<[string, string | undefined]> = [["Post by", brief.postBy], ["Goal", brief.goal], ["Angle", brief.angle], ["Hook", brief.hook],
    ["Twist", brief.twist], ["Takeaway", brief.takeaway], ["Save prompt", brief.savePrompt], ["Caption question", brief.captionQuestion], ["Series", brief.series], ["Emotion", brief.emotion],
    ["Treatment", brief.treatment], ["Signature moment", brief.signatureMoment], ["References", brief.references], ["Notes", brief.notes]];
  return (
    <section className={r.card} aria-labelledby="brief-title">
      <h2 id="brief-title" className={r.subtitle}>Your brief</h2>
      <dl className={r.facts}>{rows.filter(([, value]) => value).map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl>
      {brief.facts?.length ? <><h3 className={r.label}>Facts</h3><ul>{brief.facts.map((fact) => <li key={fact.claim}>{fact.claim} <span className={r.muted}>({fact.source || "no source"})</span></li>)}</ul></> : null}
    </section>
  );
}

function IdeaStep({ reel, macState, onChoose, onRetry }: { reel: ReelView; macState: MacState; onChoose: (idea: ReelIdea) => void; onRetry: () => void }) {
  const job = reel.jobs.idea;
  const { brief, reference, topic } = reel.document;
  if (brief) {
    return (
      <>
        <div>
          <span className={r.eyebrow}>Step 01 · Idea</span>
          <h1 className={r.title}>{brief.title ?? reel.title}</h1>
          <p className={r.lede}>From your brief. The script step starts from it.</p>
        </div>
        <BriefCard brief={brief} />
      </>
    );
  }
  const ideas = (job?.result?.ideas as ReelIdea[] | undefined) ?? [];
  const breakdown = job?.result?.breakdown as Breakdown | undefined;
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 01 · Idea</span>
        <h1 className={r.title}>{reference ? "Learn from the reel" : "Pick the story"}</h1>
        <p className={r.lede}>{reference ? "A breakdown of the reel, then three Tiny Soho angles that borrow what works."
          : topic ? `Topic: ${topic}` : "Three ideas for a 20–30 second story reel."}</p>
      </div>
      <JobState job={job} macState={macState} onRetry={onRetry} />
      {breakdown && <BreakdownCard breakdown={breakdown} />}
      {ideas.length > 0 && (
        <div className={r.ideas}>
          {ideas.map((idea) => {
            const chosen = reel.document.idea?.title === idea.title;
            return (
              <article key={idea.title} className={`${r.idea} ${chosen ? r.chosen : ""}`}>
                <h2>{idea.title}</h2>
                <p className={r.hook}>“{idea.hook}”</p>
                <p className={r.muted}>{idea.why}</p>
                <button type="button" className={chosen ? r.secondary : r.primary} onClick={() => onChoose(idea)}>{chosen ? "Chosen · use again" : reference ? "Use this angle" : "Use this idea"}</button>
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
        {reel.document.brief && <p className={r.muted}>{reel.document.brief.scriptDraft?.length ? "Your script from the brief, timed and checked." : "Written from your brief."}</p>}
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
