"use client";
import { hasClearance } from "../../lib/carousel";
import type { Slide } from "./model";
import type { useCarouselWorkspace } from "./useCarouselWorkspace";
import s from "./studio.module.css";
type Workspace = ReturnType<typeof useCarouselWorkspace>;
export function WorkflowControls({
  slide,
  patch,
  workspace,
}: {
  slide: Slide;
  patch: (patch: Partial<Slide>) => void;
  workspace: Workspace;
}) {
  const pending = !!slide.run && !slide.run.outputAssetId;
  const ready = hasClearance(slide.region, slide.protectedRegions);
  return (
    <section className={s.workflowControls} aria-label="Save and create video">
      <button
        className={s.secondary}
        disabled={workspace.busy || pending}
        onClick={() => void workspace.analyze(slide.id)}
      >
        Suggest a story from this image
      </button>
      {slide.analysisSummary && (
        <p>{slide.analysisSummary} Suggestions need your review.</p>
      )}
      <fieldset disabled={workspace.busy || pending}>
        <legend>Keep these areas fixed</legend>
        <p>
          All artwork outside the movement area stays fixed. Mark every text
          block and leave room for the whole action.
        </p>
        {slide.protectedRegions.map((region, index) => (
          <details key={index}>
            <summary>Protected area {index + 1}</summary>
            {(["x", "y", "width", "height"] as const).map((key) => (
              <label key={key}>
                {key}
                <input
                  aria-label={`Protected area ${index + 1} ${key}`}
                  type="number"
                  min={key === "width" || key === "height" ? 0.1 : 0}
                  max="100"
                  step="0.5"
                  value={region[key]}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    const updated = { ...region, [key]: value };
                    updated.width = Math.max(
                      0.1,
                      Math.min(updated.width, 100 - updated.x),
                    );
                    updated.height = Math.max(
                      0.1,
                      Math.min(updated.height, 100 - updated.y),
                    );
                    updated.x = Math.min(99.9, Math.max(0, updated.x));
                    updated.y = Math.min(99.9, Math.max(0, updated.y));
                    patch({
                      protectedRegions: slide.protectedRegions.map((r, i) =>
                        i === index ? updated : r,
                      ),
                    });
                  }}
                />
              </label>
            ))}
            <button
              onClick={() =>
                patch({
                  protectedRegions: slide.protectedRegions.filter(
                    (_, i) => i !== index,
                  ),
                })
              }
            >
              Remove area {index + 1}
            </button>
          </details>
        ))}
        <button
          className={s.textButton}
          disabled={slide.protectedRegions.length >= 50}
          onClick={() =>
            patch({
              protectedRegions: [
                ...slide.protectedRegions,
                { x: 0, y: 0, width: 100, height: 15 },
              ],
            })
          }
        >
          + Protect a text area
        </button>
        {!ready && (
          <p role="alert">
            Leave at least 2% clearance between movement and marked text.
          </p>
        )}
        <label className={s.reviewCheck}>
          <input
            type="checkbox"
            checked={!!slide.reviewed}
            disabled={!ready || !slide.story.trim()}
            onChange={(e) => patch({ reviewed: e.target.checked })}
          />
          I reviewed the story and all text. The full action, including hair and
          hands, fits inside the movement area.
        </label>
      </fieldset>
      {!workspace.acknowledged && (
        <div className={s.reviewNote}>
          <div>
            <strong>Connect your WAN generation</strong>
            <p>
              WAN uses your Alibaba account and can incur charges. Enable Free
              Quota Only in Alibaba if you rely on free quota. Studio cannot
              verify your remaining quota.
            </p>
            <button
              disabled={workspace.busy}
              onClick={() => void workspace.acknowledge()}
            >
              I understand — enable WAN
            </button>
          </div>
        </div>
      )}
      {pending ? (
        <>
          <p role="status">
            {workspace.runStatus[slide.id] ||
              "Saved generation awaiting processing…"}
          </p>
          <button
            className={s.secondary}
            disabled={workspace.busy}
            onClick={() => workspace.resume(slide.id)}
          >
            Resume saved request
          </button>
          <button
            className={s.textButton}
            disabled={
              workspace.busy ||
              !workspace.runStatus[slide.id]?.startsWith("Needs attention:")
            }
            onClick={() => void workspace.retry(slide.id)}
          >
            Review a new attempt
          </button>
          <p>
            Closing the page keeps the WAN job. Finishing resumes when you
            reopen this project.
          </p>
        </>
      ) : (
        <button
          className={s.primary}
          disabled={
            workspace.busy ||
            !workspace.acknowledged ||
            !slide.reviewed ||
            !ready ||
            !slide.story.trim()
          }
          onClick={() => void workspace.generate(slide.id)}
        >
          {slide.run?.outputAssetId
            ? "Create another version"
            : "Create 5-second video"}
        </button>
      )}
      {slide.run?.outputAssetId && (
        <p>
          Review the finished video for clipped edges, changed faces or
          unnatural action before publishing.
        </p>
      )}
    </section>
  );
}
