"use client";
import { useEffect, useRef, useState } from "react";
import type { SlideV2, TakeView } from "@/lib/contract";
import type { CreationApi } from "../api";
import { CheckBadges } from "./CheckBadges";
import s from "./takes.module.css";
export function TakeGrid({
  api,
  slide,
  takes,
  active = true,
  busy,
  downloading = null,
  onChoose,
  onDownload,
  onRefresh,
}: {
  api: CreationApi;
  slide: SlideV2;
  takes: TakeView[];
  active?: boolean;
  busy: boolean;
  /** `${takeId}:${kind}` of the download in progress, if any. Only that button waits. */
  downloading?: string | null;
  onChoose: (id: string) => Promise<unknown>;
  onDownload: (id: string, kind: "clip" | "cover") => Promise<unknown>;
  onRefresh: () => void;
}) {
  const [images, setImages] = useState<{
      background: string;
      text: string | null;
    } | null>(null),
    [playing, setPlaying] = useState(false),
    [mediaError, setMediaError] = useState(false);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  useEffect(() => {
    let disposed = false;
    const load = () => {
      if (!slide.layers.backgroundAssetId) return;
      void Promise.all([
        api.assetUrl(slide.layers.backgroundAssetId),
        slide.layers.textAssetId
          ? api.assetUrl(slide.layers.textAssetId)
          : null,
      ])
        .then(([background, text]) => {
          if (!disposed) setImages({ background, text });
        })
        .catch(() => {
          if (!disposed) setMediaError(true);
        });
    };
    load();
    const timer = setInterval(load, 240000);
    window.addEventListener("focus", load);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      videos.current.forEach((video) => video.pause());
    };
  }, [api, slide.layers.backgroundAssetId, slide.layers.textAssetId]);
  const media = takes
    .map((take) => `${take.id}:${take.finalVideoUrl}`)
    .join(",");
  useEffect(() => {
    setMediaError(false);
    setPlaying(false);
  }, [media]);
  const visibleVideos = () =>
    [...videos.current.values()].filter(
      (video) => !video.closest("details") || video.closest("details")!.open,
    );
  const play = async () => {
    const players = visibleVideos();
    if (!players.length) return;
    if (playing) {
      players.forEach((video) => video.pause());
      setPlaying(false);
      return;
    }
    players.forEach((video) => {
      video.currentTime = 0;
    });
    const results = await Promise.allSettled(
      players.map((video) => video.play()),
    );
    if (results.some((result) => result.status === "rejected")) {
      players.forEach((video) => video.pause());
      setMediaError(true);
      setPlaying(false);
    } else setPlaying(true);
  };
  const sync = (leader: HTMLVideoElement) => {
    const players = visibleVideos();
    if (players[0] !== leader) return;
    for (const video of players.slice(1))
      if (Math.abs(video.currentTime - leader.currentTime) > 0.12)
        video.currentTime = leader.currentTime;
  };
  const aspectRatio = `${slide.width ?? 4} / ${slide.height ?? 5}`;
  const card = (take: TakeView) => (
    <article
      key={take.id}
      className={s.take}
      aria-label={`Take ${take.attempt}`}
    >
      <h3>
        Take {take.attempt}
        {slide.chosenTakeId === take.id ? " · Chosen" : ""}
      </h3>
      {take.finalVideoUrl ? (
        <video
          key={take.finalVideoUrl}
          ref={(element) => {
            if (element) videos.current.set(take.id, element);
            else videos.current.delete(take.id);
          }}
          src={take.finalVideoUrl}
          poster={take.coverUrl ?? undefined}
          style={{ aspectRatio }}
          muted
          playsInline
          loop
          preload="metadata"
          aria-label={`Video take ${take.attempt}`}
          onTimeUpdate={(event) => sync(event.currentTarget)}
          onError={() => setMediaError(true)}
        />
      ) : (
        <p className={s.muted}>
          This take is{" "}
          {take.stage === "failed"
            ? "unavailable"
            : take.stage === "finishing"
              ? "getting its text"
              : take.stage === "checking"
                ? "being checked"
                : "animating"}
          .
        </p>
      )}
      <CheckBadges active={active} take={take} hasText={Boolean(slide.layers.textAssetId)} />
      {take.finalVideoUrl && (
        <div className={s.actions}>
          <button
            className={s.primary}
            disabled={
              busy ||
              slide.chosenTakeId === take.id ||
              take.verdict === "pending"
            }
            onClick={() => void onChoose(take.id)}
          >
            {slide.chosenTakeId === take.id
              ? "Chosen"
              : take.verdict === "rejected"
                ? "Use this take anyway"
                : "Choose this take"}
          </button>
          <button
            className={s.secondary}
            disabled={downloading === `${take.id}:clip`}
            aria-busy={downloading === `${take.id}:clip`}
            onClick={() => void onDownload(take.id, "clip")}
          >
            {downloading === `${take.id}:clip` ? "Downloading…" : "Download this clip"}
          </button>
          {take.coverUrl && (
            <button
              className={s.secondary}
              disabled={downloading === `${take.id}:cover`}
              aria-busy={downloading === `${take.id}:cover`}
              onClick={() => void onDownload(take.id, "cover")}
            >
              {downloading === `${take.id}:cover` ? "Downloading…" : "Download cover image"}
            </button>
          )}
        </div>
      )}
    </article>
  );
  const rejected = takes.filter((take) => take.verdict === "rejected");
  return (
    <>
      <div className={s.grid}>
        <figure className={s.take}>
          <figcaption>Your design</figcaption>
          <div className={s.original} style={{ aspectRatio }}>
            {images && (
              <>
                <img
                  src={images.background}
                  alt={`Original ${slide.name}`}
                  onError={() => setMediaError(true)}
                />
                {images.text && (
                  <img
                    src={images.text}
                    alt=""
                    onError={() => setMediaError(true)}
                  />
                )}
              </>
            )}
          </div>
        </figure>
        {takes.filter((take) => take.verdict !== "rejected").map(card)}
      </div>
      {rejected.length > 0 && (
        <details
          onToggle={(event) => {
            if (!event.currentTarget.open)
              rejected.forEach((take) => videos.current.get(take.id)?.pause());
          }}
        >
          <summary>Show rejected takes ({rejected.length})</summary>
          <div className={s.grid}>{rejected.map(card)}</div>
        </details>
      )}
      {takes.some((take) => take.finalVideoUrl) && (
        <>
          <button className={s.secondary} onClick={() => void play()}>
            {playing ? "Pause takes" : "Play takes together"}
          </button>
          <p className={s.muted}>
            Automatic checks help shortlist takes. Watch your chosen take before
            downloading.
          </p>
        </>
      )}
      {mediaError && (
        <p role="status">
          A preview couldn’t load.{" "}
          <button className={s.secondary} onClick={onRefresh}>
            Reload preview links
          </button>
        </p>
      )}
    </>
  );
}
