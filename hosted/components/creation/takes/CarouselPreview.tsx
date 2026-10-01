"use client";
import { useEffect, useRef, useState } from "react";
import type { CreationView, SlideV2, TakeView } from "@/lib/contract";
import type { CreationApi } from "../api";
import { chosenTake } from "../export/download";
import s from "./takes.module.css";
export function CarouselPreview({
  api,
  creation,
}: {
  api: CreationApi;
  creation: CreationView;
}) {
  const slides = [...creation.document.slides].sort(
    (a, b) => a.order - b.order,
  );
  const [index, setIndex] = useState(0),
    [open, setOpen] = useState(false),
    [take, setTake] = useState<TakeView | null>(null),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const [continuing, setContinuing] = useState(false);
  const slide: SlideV2 | undefined = slides[index];
  const sequence = slides
    .map((s) => `${s.id}:${s.chosenTakeId ?? ""}`)
    .join(",");
  useEffect(() => {
    setIndex(0);
  }, [creation.id, sequence]);
  useEffect(() => {
    if (open) dialog.current?.showModal?.();
  }, [open]);
  useEffect(() => {
    let disposed = false;
    setTake(null);
    setError("");
    if (!open || !slide?.chosenTakeId) return;
    void chosenTake(api, slide)
      .then((take) => {
        if (!disposed) {
          setTake(take);
          if (!take?.finalVideoUrl)
            setError("The chosen take is not ready to play.");
        }
      })
      .catch(() => {
        if (!disposed)
          setError(
            "The chosen take couldn’t load. Close and reopen for a fresh link.",
          );
      });
    return () => {
      disposed = true;
    };
  }, [api, open, slide?.id, slide?.chosenTakeId]);
  const close = () => {
    video.current?.pause();
    dialog.current?.close();
    setOpen(false);
    setContinuing(false);
  };
  return (
    <div className={s.export}>
      <button
        className={s.secondary}
        disabled={!slides.some((s) => s.chosenTakeId)}
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
      >
        Preview carousel
      </button>
      {open && (
        <dialog
          ref={dialog}
          className={s.dialog}
          aria-label="Chosen carousel preview"
          onCancel={close}
        >
          <div className={s.dialogHead}>
            <h2 className={s.title}>
              Your carousel · Slide {index + 1} of {slides.length}
            </h2>
            <button className={s.secondary} onClick={close}>
              Close carousel preview
            </button>
          </div>
          <nav className={s.sequence} aria-label="Carousel slide order">
            {slides.map((item, i) => (
              <button
                key={item.id}
                aria-current={i === index ? "step" : undefined}
                className={s.secondary}
                onClick={() => setIndex(i)}
              >
                {i + 1}. {item.name}
                {item.chosenTakeId ? " · Chosen" : " · Not chosen"}
              </button>
            ))}
          </nav>
          {slide && (
            <>
              <h3>{slide.name}</h3>
              {!slide.chosenTakeId ? (
                <p>Choose a take for this slide first.</p>
              ) : error ? (
                <p role="status">{error}</p>
              ) : take?.finalVideoUrl ? (
                <video
                  ref={video}
                  key={`${slide.id}:${take.finalVideoUrl}`}
                  src={take.finalVideoUrl}
                  poster={take.coverUrl ?? undefined}
                  muted
                  playsInline
                  controls
                  autoPlay={continuing}
                  onPlay={() => setContinuing(true)}
                  style={{
                    aspectRatio: `${slide.width ?? 4} / ${slide.height ?? 5}`,
                  }}
                  className={s.carouselVideo}
                  aria-label={`Chosen ${slide.name}`}
                  onError={() =>
                    setError(
                      "The preview link may have expired. Close and reopen to refresh it.",
                    )
                  }
                  onEnded={() => {
                    if (index + 1 < slides.length) setIndex(index + 1);
                  }}
                />
              ) : (
                <p>Loading chosen take…</p>
              )}
              <div className={s.actions}>
                <button
                  className={s.secondary}
                  disabled={index === 0}
                  onClick={() => setIndex((i) => i - 1)}
                >
                  Previous slide
                </button>
                <button
                  className={s.secondary}
                  disabled={index + 1 >= slides.length}
                  onClick={() => setIndex((i) => i + 1)}
                >
                  Next slide
                </button>
              </div>
            </>
          )}
        </dialog>
      )}
    </div>
  );
}
