"use client";

import { useState } from "react";

import type { ReelAction, ReelView } from "@/lib/reels";
import type { MacState } from "@/components/shell/ShellBar";
import { active, CommentBox, CopyButton, JobState } from "./job-state";
import r from "./reels.module.css";

type Act = (action: ReelAction) => Promise<unknown>;

/** Sound: listen to the reel with music and effects, change the music level (free), new music, change sounds, approve. */
export function SoundStep({ reel, macState, act, onRetry }: { reel: ReelView; macState: MacState; act: Act; onRetry: () => void }) {
  const sound = reel.document.sound;
  const latest = sound?.versions.at(-1);
  const job = reel.jobs.sound;
  const busy = active(job);
  const locked = Boolean(sound?.approved);
  const [level, setLevel] = useState<number | null>(null);
  const shown = level ?? latest?.musicDb ?? -9;
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 07 · Sound</span>
        <h1 className={r.title}>{locked ? "Sound approved" : latest ? "Approve the sound" : "Making the sound"}</h1>
        <p className={r.lede}>New music for this reel from ElevenLabs Music, one fresh sound on each on-screen action, and your voice on top, mixed to Instagram's −14 LUFS.</p>
      </div>
      <JobState job={job} macState={macState} onRetry={onRetry} />
      {latest && (
        <>
          <p className={r.muted}>Version {latest.version} · {latest.seconds.toFixed(1)} s · {latest.cues.length} sounds · music {latest.musicDb} dB under the voice{latest.characters ? ` · ${latest.characters} ElevenLabs characters for new sounds` : ""}</p>
          {reel.soundUrl ? <video className={r.preview} controls playsInline preload="metadata" src={reel.soundUrl} aria-label={`The reel with sound, version ${latest.version}`} />
            : <p className={r.muted}>The preview link is loading.</p>}
          <details className={r.promptDetails}>
            <summary>Music brief</summary>
            <p>{latest.musicPrompt}</p>
          </details>
          <div className={r.tableWrap}>
            <table className={r.table}>
              <thead><tr><th>Time</th><th>Sound</th><th>What it is</th></tr></thead>
              <tbody>{latest.cues.map((cue, index) => (
                <tr key={`${cue.t}-${index}`}><td className={r.time}>{cue.t.toFixed(2)} s</td><td>{cue.name}</td><td>{cue.prompt}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {!locked && !busy && (
            <div className={r.actions}>
              <label htmlFor="music-level" className={r.label}>Music level under the voice: {shown} dB</label>
              <div className={r.inline}>
                <input id="music-level" type="range" min={-18} max={-3} step={1} value={shown} onChange={(event) => setLevel(Number(event.target.value))} />
                <button type="button" className={r.secondary} disabled={shown === latest.musicDb}
                  onClick={() => { void act({ action: "music_level", db: shown }).then(() => setLevel(null)); }}>Apply level</button>
              </div>
              <p className={r.muted}>Changing the level only remixes; it uses no ElevenLabs credits.</p>
              <CommentBox id="change-sounds" label="Change the sounds" placeholder="For example: softer stamp, no sound on the last scene"
                submit="Change sounds" onSend={(comments) => act({ action: "change_sounds", comments })} />
              <div className={r.buttons}>
                <button type="button" className={r.secondary} onClick={() => void act({ action: "new_music" })}>New music</button>
                <button type="button" className={r.primary} onClick={() => void act({ action: "approve_sound" })}>Approve sound</button>
              </div>
            </div>
          )}
          {locked && <p className={r.status}>Approved. The final export comes next.</p>}
        </>
      )}
    </>
  );
}

/** Export: the final 1080×1920 video with sound, its cover and caption, ready to download and post. */
export function ExportStep({ reel, macState, act, onRetry }: { reel: ReelView; macState: MacState; act: Act; onRetry: () => void }) {
  const latest = reel.document.export?.versions.at(-1);
  const job = reel.jobs.export;
  const busy = active(job);
  const urls = reel.exportUrls;
  const fullCaption = latest ? `${latest.caption}\n\n${latest.hashtags.join(" ")}`.trim() : "";
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 08 · Export</span>
        <h1 className={r.title}>{latest ? "Your reel is ready" : "Rendering the final video"}</h1>
        <p className={r.lede}>The final 1080×1920 video at 30 fps with motion blur and the approved sound, plus its cover and a caption.</p>
      </div>
      <JobState job={job} macState={macState} onRetry={onRetry} />
      {latest && (
        <>
          <p className={r.muted}>Version {latest.version} · {latest.seconds.toFixed(1)} s · {(latest.bytes / 1_000_000).toFixed(1)} MB · 1080×1920 · 30 fps</p>
          {urls?.video ? <video className={r.preview} controls playsInline preload="metadata" src={urls.video} aria-label="The final reel" />
            : <p className={r.muted}>The video link is loading.</p>}
          <div className={r.buttons}>
            {urls?.download && <a className={r.primary} href={urls.download} download>Download video</a>}
            {urls?.cover && <a className={r.secondary} href={urls.cover} target="_blank" rel="noreferrer">Open cover</a>}
            {!busy && <button type="button" className={r.link} onClick={() => void act({ action: "export_again" })}>Export again</button>}
          </div>
          <section className={r.card} aria-labelledby="caption-title">
            <div className={r.summary}>
              <h2 id="caption-title" className={r.subtitle}>Caption</h2>
              <CopyButton text={fullCaption} label="Copy caption" />
            </div>
            <p className={r.caption}>{latest.caption}</p>
            <p className={r.muted}>{latest.hashtags.join(" ")}</p>
          </section>
        </>
      )}
    </>
  );
}
