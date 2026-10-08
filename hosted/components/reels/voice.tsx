"use client";

import type { ReelAction, ReelVoiceTake, ReelView } from "@/lib/reels";
import type { MacState } from "@/components/shell/ShellBar";
import { active, CommentBox, JobState } from "./job-state";
import { spoken } from "./sketches";
import r from "./reels.module.css";

type Act = (action: ReelAction) => Promise<unknown>;

const seconds = (value: number) => `${value.toFixed(1)} s`;

function CueCheck({ take }: { take: ReelVoiceTake }) {
  const { ok, spokenCues, heard } = take.cueCheck;
  if (!ok) return <p className={r.reviewRedo}><b>Read a cue aloud:</b> “{spokenCues.join("”, “")}”. Redo the line it's in.</p>;
  return <p className={r.reviewGood}><b>No cues read aloud.</b>{heard !== null ? ` ${Math.round(heard * 100)}% of the script heard clearly.` : ""}</p>;
}

function TakeCard({ take, url, chosen, locked, busy, act }: {
  take: ReelVoiceTake; url?: string; chosen: boolean; locked: boolean; busy: boolean; act: Act;
}) {
  return (
    <article className={`${r.idea} ${chosen ? r.chosen : ""}`} aria-label={`${take.label} take`}>
      <h2>{take.label}</h2>
      <p className={r.muted}>{seconds(take.seconds)} · {take.gap.toFixed(2)} s between lines</p>
      {url ? <audio className={r.audio} controls preload="none" src={url} aria-label={`Play the ${take.label.toLowerCase()} take`} />
        : <p className={r.muted}>The recording link is loading.</p>}
      <CueCheck take={take} />
      {!locked && <button type="button" className={chosen ? r.secondary : r.primary} disabled={busy} onClick={() => void act({ action: "choose_take", take: take.id })}>
        {chosen ? "Chosen" : "Use this take"}</button>}
      <ol className={r.voiceLines}>
        {take.lines.map((line) => (
          <li key={line.n}>
            <span className={r.time}>{line.start.toFixed(1)}–{line.end.toFixed(1)} s</span>
            <span>{spoken(line.text)}</span>
            {!locked && !busy && <CommentBox id={`redo-${take.id}-${line.n}`} label="Redo this line" placeholder="For example: slower, more curious, softer ending"
              submit="Redo line" onSend={(note) => act({ action: "redo_line", take: take.id, n: line.n, note })} />}
          </li>
        ))}
      </ol>
    </article>
  );
}

/** Voice: two takes in the cloned voice, a cue check on each, redo one line, choose a take and approve. */
export function VoiceStep({ reel, macState, act, onRetry }: { reel: ReelView; macState: MacState; act: Act; onRetry: () => void }) {
  const voice = reel.document.voice;
  const job = reel.jobs.voice;
  const busy = active(job);
  const locked = Boolean(voice?.approved);
  const credits = voice?.credits;
  const notSetUp = job?.status === "failed" && job.errorCode === "elevenlabs_not_set_up";
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 05 · Voice</span>
        <h1 className={r.title}>{locked ? "Voice approved" : "Choose the voice take"}</h1>
        <p className={r.lede}>The Studio Mac records the approved script in your cloned voice twice, a natural take and a tighter one, and checks each for voice cues read aloud.</p>
      </div>
      {notSetUp ? (
        <div className={r.failed} role="alert">
          <p>The Studio Mac needs your ElevenLabs key. Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to ~/.config/tiny-soho/runner.env, then try again.</p>
          <button type="button" className={r.secondary} onClick={onRetry}>Try again</button>
        </div>
      ) : <JobState job={job} macState={macState} onRetry={onRetry} />}
      {credits && <p className={r.muted}>Last recording used {credits.used.toLocaleString()} ElevenLabs characters{credits.remaining !== null ? ` · ${credits.remaining.toLocaleString()}${credits.limit ? ` of ${credits.limit.toLocaleString()}` : ""} left this month` : ""}.</p>}
      {voice && voice.takes.length > 0 && (
        <div className={r.ideas}>
          {voice.takes.map((take) => (
            <TakeCard key={`${take.id}-${take.objectPath}`} take={take} url={reel.voiceUrls?.[take.id]} chosen={voice.chosen === take.id} locked={locked} busy={busy} act={act} />
          ))}
        </div>
      )}
      {voice && !locked && !busy && (
        <div className={r.actions}>
          <div className={r.buttons}>
            <button type="button" className={r.secondary} onClick={() => void act({ action: "new_takes" })}>Make new takes</button>
            <button type="button" className={r.primary} disabled={!voice.chosen} onClick={() => void act({ action: "approve_voice" })}>Approve voice</button>
          </div>
          {!voice.chosen && <p className={r.muted}>Choose a take to approve it.</p>}
        </div>
      )}
      {locked && <p className={r.status}>Approved. The Build step comes next.</p>}
    </>
  );
}
