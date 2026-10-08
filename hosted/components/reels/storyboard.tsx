"use client";

import { useState } from "react";

import { storyboardImages, type ReelAction, type ReelImage, type ReelLook, type ReelScene, type ReelView } from "@/lib/reels";
import type { MacState } from "@/components/shell/ShellBar";
import { active, CommentBox, CopyButton, JobState } from "./job-state";
import r from "./reels.module.css";

type Act = (action: ReelAction) => Promise<unknown>;

const REFERENCE_NAMES = { anaika: "Anaika's character sheet", mum: "Mum's character sheet", none: "" } as const;

/** One image's prompt as it should be pasted into an image tool, with the details a person needs beside it. */
function imageBrief(image: ReelImage) {
  const extras = [`Aspect ${image.aspect}`, image.background === "transparent" ? "transparent background" : "with background",
    image.reference !== "none" ? `attach ${REFERENCE_NAMES[image.reference]}` : ""].filter(Boolean).join(" · ");
  return `${image.file}\n${image.prompt}\n(${extras})`;
}

/** Every new image's prompt, numbered, for pasting into an image tool in one go. */
export function allPrompts(scenes: ReelScene[]) {
  return storyboardImages({ version: 0, scenes }).filter((image) => !image.reuse)
    .map((image, index) => `${index + 1}. Scene ${image.scene}: ${imageBrief(image)}`).join("\n\n");
}

function LookCard({ look, children }: { look: ReelLook; children?: React.ReactNode }) {
  return (
    <article className={r.idea}>
      <h2>{look.name}</h2>
      <p className={r.hook}>{look.treatment}</p>
      <dl className={r.facts}>
        <dt>Emotion</dt><dd>{look.emotion}</dd>
        <dt>Accent</dt><dd>{look.accent}</dd>
        <dt>Signature moment</dt><dd>{look.signatureMoment}</dd>
        <dt>Music</dt><dd>{look.music}</dd>
      </dl>
      {look.why && <p className={r.muted}>{look.why}</p>}
      {children}
    </article>
  );
}

/** Storyboard, part A: choose the look before any scenes or image prompts are written. */
function LookPart({ reel, macState, act, onRetry }: { reel: ReelView; macState: MacState; act: Act; onRetry: () => void }) {
  const look = reel.document.look;
  const job = reel.jobs.storyboard;
  const working = active(job) || job?.status === "failed";
  const [own, setOwn] = useState("");
  if (look?.chosen) {
    return (
      <section className={r.panel} aria-labelledby="look-title">
        <h2 id="look-title" className={r.subtitle}>The look</h2>
        <LookCard look={look.chosen} />
        {!reel.document.storyboard?.approved && (
          <div className={r.buttons}>
            <CommentBox id="change-chosen-look" label="Change this look" placeholder="For example: warmer, less scrappy, keep the calendar idea"
              submit="Send changes" onSend={(comments) => act({ action: "revise_look", comments })} />
            <button type="button" className={r.link} onClick={() => void act({ action: "more_looks" })}>Show other looks</button>
          </div>
        )}
      </section>
    );
  }
  const options = look?.options ?? [];
  return (
    <section className={r.panel} aria-labelledby="look-title">
      <h2 id="look-title" className={r.subtitle}>{options.length > 1 ? "Pick a look" : "The look"}</h2>
      <p className={r.lede}>The look comes first. Scenes and image prompts are written after you approve it.</p>
      {working && <JobState job={job} macState={macState} onRetry={onRetry} />}
      {!working && options.length > 0 && (
        <>
          <div className={r.ideas}>
            {options.map((option, index) => (
              <LookCard key={`${option.name}-${index}`} look={option}>
                <button type="button" className={r.primary} onClick={() => void act({ action: "choose_look", index })}>Use this look</button>
                <CommentBox id={`change-look-${index}`} label="Change this one" placeholder="For example: keep the diary, lose the riso print"
                  submit="Send changes" onSend={(comments) => act({ action: "revise_look", comments, index })} />
              </LookCard>
            ))}
          </div>
          <div className={r.actions}>
            <div className={r.buttons}>
              <button type="button" className={r.secondary} onClick={() => void act({ action: "more_looks" })}>Show other looks</button>
            </div>
            <label htmlFor="own-look" className={r.label}>Or describe your own</label>
            <textarea id="own-look" className={r.field} rows={3} value={own} maxLength={1000}
              placeholder="For example: like a phone notes app at 2 am, typing and deleting. Paste reference links too."
              onChange={(event) => setOwn(event.target.value)} />
            <div><button type="button" className={r.secondary} disabled={!own.trim()}
              onClick={() => { void act({ action: "own_look", description: own.trim() }).then(() => setOwn("")); }}>Use my description</button></div>
          </div>
        </>
      )}
    </section>
  );
}

function ImageRow({ image, scene, locked, act }: { image: ReelImage; scene: number; locked: boolean; act: Act }) {
  const [prompt, setPrompt] = useState(image.prompt);
  const edited = prompt.trim() !== image.prompt;
  const id = `prompt-${scene}-${image.file}`;
  return (
    <li className={r.image}>
      <div className={r.imageHead}>
        <b>{image.file}</b>
        <span className={r.tags}>
          {image.reuse ? <span className={r.tag}>Reuse: {image.reuse}</span> : <span className={r.tag}>Make</span>}
          <span className={r.tag}>{image.aspect}</span>
          <span className={r.tag}>{image.background === "transparent" ? "Transparent" : "Background"}</span>
          {image.reference !== "none" && <span className={r.tag}>Attach {REFERENCE_NAMES[image.reference]}</span>}
        </span>
      </div>
      {image.purpose && <p className={r.muted}>{image.purpose}</p>}
      {!image.reuse && (
        <>
          <label htmlFor={id} className={r.label}>Prompt</label>
          <textarea id={id} className={r.field} rows={3} value={prompt} maxLength={1200} readOnly={locked} onChange={(event) => setPrompt(event.target.value)} />
          <div className={r.buttons}>
            <CopyButton text={imageBrief({ ...image, prompt })} />
            {edited && !locked && <button type="button" className={r.secondary} disabled={!prompt.trim()}
              onClick={() => void act({ action: "edit_image_prompt", scene, file: image.file, prompt: prompt.trim() })}>Save prompt</button>}
          </div>
        </>
      )}
      {!locked && <CommentBox id={`change-image-${scene}-${image.file}`} label="Change this image" placeholder="For example: make Anaika sleepier, not sad"
        submit="Send changes" onSend={(comments) => act({ action: "revise_storyboard", comments, scene, image: image.file })} />}
    </li>
  );
}

/** Storyboard, part B: one card per scene with what code draws and the images to make. */
function ScenesPart({ reel, macState, act, onRetry }: { reel: ReelView; macState: MacState; act: Act; onRetry: () => void }) {
  const storyboard = reel.document.storyboard;
  const job = reel.jobs.storyboard;
  const locked = Boolean(storyboard?.approved);
  const images = storyboardImages(storyboard);
  const toMake = images.filter((image) => !image.reuse).length;
  return (
    <section className={r.panel} aria-labelledby="scenes-title">
      <h2 id="scenes-title" className={r.subtitle}>Scenes and images</h2>
      <JobState job={job} macState={macState} onRetry={onRetry} />
      {storyboard && (
        <>
          <div className={r.summary}>
            <p className={r.muted}>Version {storyboard.version} · {storyboard.scenes.length} scenes · {toMake} image{toMake === 1 ? "" : "s"} to make · {images.length - toMake} reused</p>
            {toMake > 0 && <CopyButton text={allPrompts(storyboard.scenes)} label="Copy all prompts" />}
          </div>
          {storyboard.notes && <p className={r.note}>{storyboard.notes}</p>}
          <ol className={r.scenes}>
            {storyboard.scenes.map((scene) => (
              <li key={scene.n} className={r.scene}>
                <div className={r.sceneHead}><span className={r.stepNo}>{String(scene.n).padStart(2, "0")}</span><p className={r.hook}>{scene.line}</p></div>
                <dl className={r.facts}>
                  <dt>Paper</dt><dd>{scene.paper}</dd>
                  <dt>Code draws</dt><dd>{scene.codeDraws}</dd>
                  <dt>Move</dt><dd>{scene.move}</dd>
                  <dt>Into next</dt><dd>{scene.transition}</dd>
                </dl>
                {scene.images.length > 0 && <ul className={r.images}>{scene.images.map((image) => (
                  <ImageRow key={`${storyboard.version}-${image.file}`} image={image} scene={scene.n} locked={locked} act={act} />
                ))}</ul>}
                {!locked && <CommentBox id={`change-scene-${scene.n}`} label="Change this scene" placeholder="For example: the clock should spin backwards"
                  submit="Send changes" onSend={(comments) => act({ action: "revise_storyboard", comments, scene: scene.n })} />}
              </li>
            ))}
          </ol>
          {!locked && !active(job) && (
            <div className={r.actions}>
              <CommentBox id="change-storyboard" label="Ask for changes to the whole storyboard" placeholder="For example: fewer images, reuse more from reel 01"
                submit="Send changes" onSend={(comments) => act({ action: "revise_storyboard", comments })} />
              {(reel.document.storyboardHistory ?? []).length > 0 && (
                <p className={r.muted}>Earlier versions: {(reel.document.storyboardHistory ?? []).map((item) => (
                  <button key={item.version} type="button" className={r.link} onClick={() => void act({ action: "restore_storyboard", version: item.version })}>Restore v{item.version}</button>
                ))}</p>
              )}
              <div className={r.buttons}><button type="button" className={r.primary} onClick={() => void act({ action: "approve_storyboard" })}>Approve storyboard</button></div>
            </div>
          )}
          {locked && <p className={r.status}>Approved. Next, make the images: the Images step lists them.</p>}
        </>
      )}
    </section>
  );
}

function References({ reel, act }: { reel: ReelView; act: Act }) {
  const [link, setLink] = useState("");
  const links = reel.document.references ?? [];
  const chosen = Boolean(reel.document.look?.chosen);
  const scenesReady = Boolean(reel.document.storyboard) && !active(reel.jobs.storyboard);
  return (
    <section className={r.panel} aria-labelledby="refs-title">
      <h2 id="refs-title" className={r.subtitle}>References <span className={r.muted}>(optional)</span></h2>
      <p className={r.lede}>The Studio Mac already draws on its motion library (styles, treatments and moves gathered from prompt-motion and motionin). Add a link only when you want one exact thing.</p>
      {links.length > 0 && (
        <>
          <ul className={r.refs}>{links.map((item) => (
            <li key={item}>
              <a href={item} target="_blank" rel="noreferrer">{item}</a>{" "}
              <button type="button" className={r.link} aria-label={`Remove ${item}`} onClick={() => void act({ action: "remove_reference", url: item })}>Remove</button>
            </li>
          ))}</ul>
          <p className={r.muted} role="status">
            {!chosen ? "Saved. The Studio Mac opens these links when you pick a look, ask for other looks or describe your own."
              : scenesReady ? "Saved. The scenes below were written before any links you add now, so redo them to use the links."
                : "Saved. The Studio Mac opens these links while it writes the scenes."}
          </p>
          {chosen && scenesReady && !reel.document.storyboard?.approved && (
            <div><button type="button" className={r.secondary}
              onClick={() => void act({ action: "revise_storyboard", comments: "Use the reference links I added: open them and take what fits this look. Keep the script and the look." })}>
              Redo scenes with these links</button></div>
          )}
        </>
      )}
      <form className={r.inline} onSubmit={(event) => { event.preventDefault(); void act({ action: "add_reference", url: link.trim() }).then(() => setLink("")); }}>
        <label htmlFor="ref-link" className={r.srOnly}>Reference link</label>
        <input id="ref-link" className={r.field} type="url" value={link} placeholder="Paste a link, then Add link" onChange={(event) => setLink(event.target.value)} />
        <button type="submit" className={r.secondary} disabled={!/^https?:\/\/\S+$/.test(link.trim())}>Add link</button>
      </form>
    </section>
  );
}

export function StoryboardStep({ reel, macState, act, onRetry }: { reel: ReelView; macState: MacState; act: Act; onRetry: () => void }) {
  const chosen = reel.document.look?.chosen;
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 03 · Storyboard</span>
        <h1 className={r.title}>{reel.document.storyboard?.approved ? "Storyboard approved" : chosen ? "Approve the storyboard" : "Choose the look"}</h1>
        <p className={r.lede}>{reel.document.brief?.series ? `Series: ${reel.document.brief.series}. ` : ""}The look first, then one card per scene with the images to make.</p>
      </div>
      <LookPart reel={reel} macState={macState} act={act} onRetry={onRetry} />
      {chosen && <ScenesPart reel={reel} macState={macState} act={act} onRetry={onRetry} />}
      {!reel.document.storyboard?.approved && <References reel={reel} act={act} />}
      {!reel.document.storyboard?.approved && !active(reel.jobs.storyboard) && (
        <button type="button" className={r.link} onClick={() => void act({ action: "back_to_script" })}>Back to the script</button>
      )}
    </>
  );
}

/** Images, for now: the list to make from the approved storyboard. Uploading comes with storage. */
export function ImagesStep({ reel }: { reel: ReelView }) {
  const images = storyboardImages(reel.document.storyboard);
  const toMake = images.filter((image) => !image.reuse);
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 04 · Images</span>
        <h1 className={r.title}>Make the images</h1>
        <p className={r.lede}>Make each image in Gemini, Seedream or Higgsfield with its prompt. Uploading them here comes next; until then, send them to Claude Code.</p>
      </div>
      {toMake.length > 0 && <div><CopyButton text={allPrompts(reel.document.storyboard?.scenes ?? [])} label="Copy all prompts" /></div>}
      <div className={r.tableWrap}>
        <table className={r.table}>
          <thead><tr><th>Scene</th><th>File</th><th>What</th><th /></tr></thead>
          <tbody>{images.map((image) => (
            <tr key={`${image.scene}-${image.file}`}>
              <td className={r.time}>{image.scene}</td>
              <td>{image.file}</td>
              <td>{image.reuse ? `Reuse: ${image.reuse}` : image.purpose || image.prompt.slice(0, 120)}</td>
              <td>{!image.reuse && <CopyButton text={imageBrief(image)} />}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
