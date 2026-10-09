"use client";

import { useRef, useState } from "react";

import { imagesReused, imagesToMake, type ReelAction, type ReelImage, type ReelUpload, type ReelView } from "@/lib/reels";
import type { MacState } from "@/components/shell/ShellBar";
import type { ReelsApi } from "./api";
import { active, CopyButton } from "./job-state";
import r from "./reels.module.css";

type Act = (action: ReelAction) => Promise<unknown>;
type MakeImage = ReelImage & { scenes: number[] };

const MIMES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;
const REFERENCES = { anaika: "Anaika's character sheet", mum: "Mum's character sheet", none: "" } as const;

const sceneList = (scenes: number[]) => `${scenes.length === 1 ? "Scene" : "Scenes"} ${scenes.join(", ")}`;

/** One image's prompt with what a person needs beside it, for pasting into an image tool. */
function promptText(image: MakeImage) {
  const extras = [`Aspect ${image.aspect}`, image.background === "transparent" ? "transparent background" : "with background",
    image.reference !== "none" ? `attach ${REFERENCES[image.reference]}` : ""].filter(Boolean).join(" · ");
  return `${image.file} (${sceneList(image.scenes)})\n${image.prompt}\n(${extras})`;
}

/**
 * Uploads run in parallel but finish one at a time, so each finished upload is recorded on the reel in turn.
 * (The server also guards against two saves at once.)
 */
let finishing: Promise<unknown> = Promise.resolve();

function ReviewLine({ upload, job, macState, onRecheck }: {
  upload: ReelUpload; job?: NonNullable<ReelView["imageJobs"]>[string]; macState: MacState; onRecheck: () => void;
}) {
  const { status, notes } = upload.review;
  if (status === "pending" && !job) {
    // An image saved without its check job (an earlier bug lost them); one click queues it.
    return (
      <div className={r.buttons}>
        <p className={r.muted} role="status">Not checked yet.</p>
        <button type="button" className={r.link} onClick={onRecheck}>Check again</button>
      </div>
    );
  }
  if (status === "pending") {
    const waiting = job?.status === "queued" && macState !== "online";
    return <p className={r.muted} role="status">{waiting ? "Waiting for the Studio Mac to look at it." : job?.status === "running" ? "The Studio Mac is looking at it…" : "Queued for the Studio Mac to look at."}</p>;
  }
  if (status === "good") return <p className={r.reviewGood} role="status"><b>Looks good.</b> {notes}</p>;
  if (status === "redo") return <p className={r.reviewRedo} role="status"><b>Redo:</b> {notes}</p>;
  return (
    <div className={r.buttons}>
      <p className={r.muted} role="status">The Studio Mac couldn't check it ({notes}).</p>
      <button type="button" className={r.link} onClick={onRecheck}>Check again</button>
    </div>
  );
}

function ImageCard({ reel, image, api, act, onReel, macState }: {
  reel: ReelView; image: MakeImage; api: ReelsApi; act: Act; onReel: (view: ReelView) => void; macState: MacState;
}) {
  const upload = reel.document.images?.[image.file];
  const url = reel.imageUrls?.[image.file];
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputId = `upload-${image.file}`;

  const send = async (file: File) => {
    setError("");
    if (!MIMES.includes(file.type)) return setError("Use a PNG, JPEG or WebP image.");
    if (file.size > MAX_BYTES) return setError("Images must be 25 MB or smaller.");
    if (image.background === "transparent" && file.type === "image/jpeg") return setError("This one needs a transparent background, so save it as a PNG or WebP.");
    try {
      setProgress(0);
      const { uploadId, uploadUrl } = await api.startImageUpload(reel.id, { file: image.file, mime: file.type, size: file.size });
      await api.uploadImage(uploadUrl, file, setProgress);
      const done = finishing.then(() => api.finishImageUpload(reel.id, { file: image.file, uploadId }));
      finishing = done.catch(() => undefined);
      onReel(await done);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The upload didn't finish. Try again.");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <li className={r.imageCard}>
      <div className={r.imageHead}>
        <b>{image.file}</b>
        <span className={r.tags}>
          <span className={r.tag}>{sceneList(image.scenes)}</span>
          <span className={r.tag}>{image.aspect}</span>
          <span className={r.tag}>{image.background === "transparent" ? "Transparent" : "Background"}</span>
          {image.reference !== "none" && <span className={r.tag}>Attach {REFERENCES[image.reference]}</span>}
        </span>
      </div>
      {image.purpose && <p className={r.muted}>{image.purpose}</p>}
      <details className={r.promptDetails}>
        <summary>Prompt</summary>
        <p>{image.prompt}</p>
      </details>
      <div className={r.buttons}><CopyButton text={promptText(image)} /></div>

      <div className={`${r.drop} ${dragging ? r.dropOver : ""} ${upload ? r.dropDone : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void send(file); }}>
        {upload && url && (
          <div className={`${r.thumb} ${image.background === "transparent" ? r.thumbClear : ""}`}>
            <img src={url} alt={`Uploaded ${image.file}`} />
          </div>
        )}
        <div className={r.dropBody}>
          {progress !== null ? <p role="status">Uploading… {Math.round(progress * 100)}%</p>
            : upload ? (
              <>
                <ul className={r.checks}>{upload.checks.map((check) => (
                  <li key={check.code} className={check.level === "ok" ? r.checkOk : check.level === "warn" ? r.checkWarn : r.checkFail}>{check.message}</li>
                ))}</ul>
                <ReviewLine upload={upload} job={reel.imageJobs?.[image.file]} macState={macState} onRecheck={() => void act({ action: "recheck_image", file: image.file })} />
              </>
            ) : <p className={r.muted}>Drop the image here, or choose a file. PNG, JPEG or WebP, up to 25 MB.</p>}
          <div className={r.buttons}>
            <label htmlFor={inputId} className={upload ? r.secondary : r.primary} role="button" tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.current?.click(); } }}>
              {upload ? "Replace" : "Choose file"}
            </label>
            <input ref={input} id={inputId} className={r.srOnly} type="file" accept={MIMES.join(",")} aria-label={`Upload ${image.file}`}
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void send(file); }} />
            {upload && <button type="button" className={r.link} disabled={progress !== null}
              onClick={() => { void api.removeImage(reel.id, image.file).then(onReel).catch((problem: Error) => setError(problem.message)); }}>Remove</button>}
          </div>
          {error && <p className={r.error} role="alert">{error}</p>}
        </div>
      </div>
    </li>
  );
}

/** Images: one card per image to make, with its prompt, an upload slot, instant checks and the Studio Mac's look. */
export function ImagesStep({ reel, api, act, onReel, macState }: {
  reel: ReelView; api: ReelsApi; act: Act; onReel: (view: ReelView) => void; macState: MacState;
}) {
  const make = imagesToMake(reel.document.storyboard);
  const reused = imagesReused(reel.document.storyboard);
  const uploads = reel.document.images ?? {};
  const uploaded = make.filter((image) => uploads[image.file]).length;
  const good = make.filter((image) => uploads[image.file]?.review.status === "good").length;
  const redo = make.filter((image) => uploads[image.file]?.review.status === "redo" || uploads[image.file]?.checks.some((check) => check.level === "fail")).length;
  const done = reel.currentStep !== "images" && reel.currentStep !== "storyboard";
  const checking = make.some((image) => active(reel.imageJobs?.[image.file]));
  return (
    <>
      <div>
        <span className={r.eyebrow}>Step 04 · Images</span>
        <h1 className={r.title}>Make the images</h1>
        <p className={r.lede}>Make each image with its prompt in Gemini, Seedream or Higgsfield, then upload it here. Studio checks the size, shape and background at once, and the Studio Mac looks at each one.</p>
      </div>
      <div className={r.summary}>
        <p className={r.muted} role="status">{uploaded} of {make.length} uploaded · {good} look good{redo ? ` · ${redo} to redo` : ""}{checking ? " · checking…" : ""}</p>
        {make.length > 0 && <CopyButton text={make.map((image, index) => `${index + 1}. ${promptText(image)}`).join("\n\n")} label="Copy all prompts" />}
      </div>
      <ul className={r.imageCards}>
        {make.map((image) => <ImageCard key={image.file} reel={reel} image={image} api={api} act={act} onReel={onReel} macState={macState} />)}
      </ul>
      {reused.length > 0 && (
        <section className={r.panel} aria-labelledby="reused-title">
          <h2 id="reused-title" className={r.subtitle}>Reused, nothing to make</h2>
          <ul className={r.refs}>{reused.map((item) => <li key={item.reuse}>{item.reuse} <span className={r.muted}>({sceneList(item.scenes)})</span></li>)}</ul>
        </section>
      )}
      {!done && (
        <div className={r.actions}>
          {redo > 0 && uploaded === make.length && <p className={r.note}>{redo} image{redo === 1 ? " is" : "s are"} marked to redo. You can replace {redo === 1 ? "it" : "them"} now, or continue and come back.</p>}
          <div className={r.buttons}>
            <button type="button" className={r.primary} disabled={uploaded < make.length} onClick={() => void act({ action: "continue_images" })}>Continue to Voice</button>
          </div>
          {uploaded < make.length && <p className={r.muted}>Continue unlocks when every image is uploaded.</p>}
        </div>
      )}
    </>
  );
}
