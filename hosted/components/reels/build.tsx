"use client";

import type { ReelAction, ReelView } from "@/lib/reels";
import type { MacState } from "@/components/shell/ShellBar";
import { active, CommentBox, JobState } from "./job-state";
import { spoken } from "./sketches";
import r from "./reels.module.css";

type Act = (action: ReelAction) => Promise<unknown>;

/** Build: Claude Code's animated reel, a preview with the voice, one still per scene, comments per scene, approve. */
export function BuildStep({ reel, macState, act, onRetry }: { reel: ReelView; macState: MacState; act: Act; onRetry: () => void }) {
  const build = reel.document.build;
  const latest = build?.versions.at(-1);
  const job = reel.jobs.build;
  const busy = active(job);
  const locked = Boolean(build?.approved);
  const scenes = reel.document.storyboard?.scenes ?? [];
  const urls = reel.buildUrls;
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 06 · Build</span>
        <h1 className={r.title}>{locked ? "Build approved" : latest ? "Approve the build" : "Building the reel"}</h1>
        <p className={r.lede}>Claude Code on the Studio Mac animates the storyboard in the motion engine, to your approved voice take, then renders a quick preview. Comment on a scene to rebuild just that scene.</p>
      </div>
      <JobState job={job} macState={macState} onRetry={onRetry} />
      {busy && latest && <p className={r.muted}>Version {latest.version} stays below until the new build is ready.</p>}
      {latest && (
        <>
          <div className={r.summary}>
            <p className={r.muted}>Reel {String(latest.reelNo).padStart(2, "0")} · version {latest.version} · {latest.seconds.toFixed(1)} s{latest.commit ? ` · saved as ${latest.commit}` : ""}</p>
          </div>
          {urls?.preview ? (
            <video className={r.preview} controls playsInline preload="metadata" src={urls.preview} aria-label={`Preview of build version ${latest.version}`} />
          ) : <p className={r.muted}>The preview link is loading.</p>}
          {latest.notes && <p className={r.note}>{latest.notes}</p>}
          <ol className={r.sheet} aria-label="Scenes in this build">
            {latest.stills.map((still) => {
              const scene = scenes.find((item) => item.n === still.n);
              return (
                <li key={still.n} className={r.sheetFrame}>
                  <p className={r.sheetHead}><span className={r.stepNo}>{String(still.n).padStart(2, "0")}</span><span className={r.time}>{still.t.toFixed(1)} s</span></p>
                  {urls?.stills[still.n] ? <img className={r.frameImage} src={urls.stills[still.n]} alt={`Scene ${still.n} at ${still.t.toFixed(1)} seconds`} />
                    : <div className={`${r.frame} ${r.frameEmpty}`}>Loading</div>}
                  {scene && <p className={r.sheetLine}>{spoken(scene.line)}</p>}
                  {!locked && !busy && <CommentBox id={`build-scene-${still.n}`} label="Change this scene" placeholder="For example: hold the calendar longer"
                    submit="Rebuild scene" onSend={(comments) => act({ action: "revise_build", comments, scene: still.n })} />}
                </li>
              );
            })}
          </ol>
          {!locked && !busy && (
            <div className={r.actions}>
              <CommentBox id="build-all" label="Ask for changes to the whole reel" placeholder="For example: slower pace overall, warmer paper"
                submit="Rebuild" onSend={(comments) => act({ action: "revise_build", comments })} />
              <div className={r.buttons}>
                <button type="button" className={r.secondary} onClick={() => void act({ action: "rebuild" })}>Build again from scratch</button>
                <button type="button" className={r.primary} onClick={() => void act({ action: "approve_build" })}>Approve build</button>
              </div>
            </div>
          )}
          {locked && <p className={r.status}>Approved. The Sound step comes next.</p>}
        </>
      )}
    </>
  );
}
