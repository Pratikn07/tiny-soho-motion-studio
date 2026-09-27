"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import Icon from "./Icons";
import {
  exampleSlides,
  exportPlan,
  imageDimensionsValid,
  INITIAL_REGION,
  intersects,
  MAX_SLIDES,
  moveSlide,
  normalizeRegion,
  updateSlide,
  validateImage,
  type Region,
  type Slide,
} from "./model";
import s from "./studio.module.css";

type View = "original" | "video" | "compare";
type Stage = "upload" | "story" | "preview";
const labels: Record<Stage, string> = {
  upload: "Upload",
  story: "Shape story",
  preview: "Preview & export",
};
const time = (value: number) =>
  `0:${Math.floor(value).toString().padStart(2, "0")}`;
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type CarouselStudioProps = {
  onOpenTools?: () => void;
  onSignOut?: () => void;
  active?: boolean;
};

export default function CarouselStudio({ onOpenTools, onSignOut, active: isActive = true }: CarouselStudioProps) {
  const [slides, setSlides] = useState<Slide[]>(exampleSlides);
  const [selectedId, setSelectedId] = useState("meal-prep");
  const [projectName, setProjectName] = useState("Everyday little moments");
  const [stage, setStage] = useState<Stage>("story");
  const [view, setView] = useState<View>("original");
  const [panel, setPanel] = useState<"story" | "movement">("story");
  const [showRegion, setShowRegion] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<{ slide: Slide; index: number } | null>(
    null,
  );
  const [compare, setCompare] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const storyInput = useRef<HTMLTextAreaElement>(null);
  const library = useRef<HTMLDialogElement>(null);
  const help = useRef<HTMLDialogElement>(null);
  const urls = useRef(new Set<string>());
  const uploadingRef = useRef(false);
  const movement = useRef<{
    startX: number;
    startY: number;
    region: Region;
    width: number;
    height: number;
    resize: boolean;
  } | null>(null);
  const active = slides.find((slide) => slide.id === selectedId) ?? slides[0];
  const activeIndex = active ? slides.indexOf(active) : -1;
  const overlap =
    active?.protectedRegions.some((rect) => intersects(active.region, rect)) ??
    false;
  const videoVisible = !!active?.video && view !== "original";

  useEffect(
    () => () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  useEffect(() => {
    setVideoReady(false);
    setVideoError(false);
    setPlaying(false);
    setCurrentTime(0);
  }, [active?.id, videoVisible]);

  useEffect(() => {
    if (!isActive) {
      video.current?.pause();
      library.current?.close();
      help.current?.close();
    }
  }, [isActive]);

  function selectSlide(id: string) {
    setSelectedId(id);
    setView("original");
    setStage("story");
    setError("");
    setNotice("");
    setShowRegion(false);
  }
  function patch(patch: Partial<Slide>) {
    if (active) setSlides((all) => updateSlide(all, active.id, patch));
  }
  async function addFiles(files: File[]) {
    if (!files.length || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setError("");
    setNotice("");
    const added: Slide[] = [],
      failures: string[] = [];
    const available = Math.max(0, MAX_SLIDES - slides.length);
    if (files.length > available)
      failures.push(
        `A project holds ${MAX_SLIDES} slides. Only the first ${available} files can be added.`,
      );
    try {
      for (const file of files.slice(0, available)) {
        const invalid = validateImage(file);
        if (invalid) {
          failures.push(invalid);
          continue;
        }
        const url = URL.createObjectURL(file);
        try {
          const dimensions = await new Promise<{
            width: number;
            height: number;
          }>((resolve, reject) => {
            const img = new Image();
            img.onload = () =>
              resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => reject(new Error("decode"));
            img.src = url;
          });
          if (!imageDimensionsValid(dimensions.width, dimensions.height))
            throw new Error("dimensions");
          urls.current.add(url);
          added.push({
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^.]+$/, ""),
            src: url,
            ...dimensions,
            origin: "upload",
            category: "Your image",
            story: "",
            selectedStory: "",
            region: { ...INITIAL_REGION },
            protectedRegions: [],
            suggestions: [],
          });
        } catch {
          URL.revokeObjectURL(url);
          failures.push(
            `${file.name}: this image could not be read, or exceeds 40 megapixels. Try another PNG, JPG or WebP.`,
          );
        }
      }
      if (added.length) {
        setSlides((all) => [...all, ...added]);
        selectSlide(added[0].id);
        setPanel("story");
        setNotice(
          `${added.length} ${added.length === 1 ? "image added" : "images added"}. Original proportions retained.`,
        );
      }
      if (failures.length) setError(failures.join(" "));
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }
  function filesChanged(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void addFiles(files);
  }
  function removeSlide() {
    if (!active) return;
    setUndo({ slide: active, index: activeIndex });
    const remaining = slides.filter((slide) => slide.id !== active.id);
    setSlides(remaining);
    setSelectedId(
      remaining[Math.min(activeIndex, remaining.length - 1)]?.id ?? "",
    );
    setView("original");
    setNotice("Slide removed.");
    setError("");
  }
  function restoreSlide() {
    if (!undo || slides.length >= MAX_SLIDES) return;
    const restored = [...slides];
    restored.splice(Math.min(undo.index, restored.length), 0, undo.slide);
    setSlides(restored);
    selectSlide(undo.slide.id);
    setUndo(null);
    setNotice("Slide restored.");
  }
  function addExample(id: string) {
    const existing = slides.find((slide) => slide.id === id);
    if (existing) selectSlide(existing.id);
    else if (slides.length < MAX_SLIDES) {
      const example = exampleSlides().find((slide) => slide.id === id)!;
      setSlides((all) => [...all, example]);
      selectSlide(id);
    } else {
      setError(
        "This project already has 20 slides. Remove one before adding another.",
      );
    }
    library.current?.close();
  }
  function savePlan() {
    if (!active?.story.trim() || overlap) return;
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            { project: projectName, ...exportPlan(active) },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      `${active.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-story-plan.json`,
    );
    setNotice(
      "Story plan downloaded. Your original image stays on this device.",
    );
  }
  function openPreview() {
    setStage("preview");
    setView(active?.video ? "video" : "original");
    setShowRegion(false);
  }
  function stageClick(next: Stage) {
    if (next === "upload") {
      setStage(next);
      setView("original");
      input.current?.click();
    }
    if (next === "story") {
      setStage(next);
      setView("original");
      setPanel("story");
      setTimeout(() => storyInput.current?.focus(), 0);
    }
    if (next === "preview") openPreview();
  }
  function startMove(event: PointerEvent<HTMLElement>, resize = false) {
    if (!active || !preview.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = preview.current.getBoundingClientRect();
    movement.current = {
      startX: event.clientX,
      startY: event.clientY,
      region: { ...active.region },
      width: bounds.width,
      height: bounds.height,
      resize,
    };
  }
  function moveRegion(event: PointerEvent<HTMLElement>) {
    const start = movement.current;
    if (!start || !active) return;
    const dx = ((event.clientX - start.startX) / start.width) * 100,
      dy = ((event.clientY - start.startY) / start.height) * 100;
    const region = start.resize
      ? {
          ...start.region,
          width: Math.min(
            100 - start.region.x,
            Math.max(5, start.region.width + dx),
          ),
          height: Math.min(
            100 - start.region.y,
            Math.max(5, start.region.height + dy),
          ),
        }
      : { ...start.region, x: start.region.x + dx, y: start.region.y + dy };
    patch({ region: normalizeRegion(region) });
  }
  async function togglePlayback() {
    if (!video.current) return;
    if (video.current.paused) {
      try {
        await video.current.play();
      } catch {
        setVideoError(true);
      }
    } else video.current.pause();
  }

  return (
    <div
      className={s.app}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length) {
          event.preventDefault();
          void addFiles(files);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <a className={s.skip} href="#workspace">
        Skip to workspace
      </a>
      <input
        ref={input}
        className={s.visuallyHidden}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        aria-label="Upload carousel images"
        onChange={filesChanged}
        disabled={uploading}
      />
      <header className={s.topbar}>
        <a href="#workspace" className={s.wordmark} aria-label="Tiny Soho Studio home">
          tiny soho<span>STUDIO</span>
        </a>
        <nav className={s.primaryNav} aria-label="Studio navigation">
          <span className={s.currentNav} aria-current="page">
            <Icon name="layers" size={17} />
            Carousel Studio
          </span>
          <button onClick={() => library.current?.showModal()}>
            <Icon name="grid" size={16} />
            Example library
          </button>
        </nav>
        <div className={s.topActions}>
          <span className={s.previewBadge}>UI preview</span>
          <button
            className={s.iconButton}
            aria-label="About this preview"
            onClick={() => help.current?.showModal()}
          >
            <Icon name="help" size={20} />
          </button>
          {onSignOut && <button className={s.accountButton} onClick={onSignOut}>Sign out</button>}
          <span className={s.avatar} aria-label="Tiny Soho workspace">
            TS
          </span>
        </div>
      </header>
      <div className={s.projectbar}>
        <div className={s.projectTitle}>
          <input
            aria-label="Project name"
            value={projectName}
            maxLength={70}
            onChange={(event) => setProjectName(event.target.value)}
          />
          <span>
            {slides.length} {slides.length === 1 ? "slide" : "slides"}
            <i />
            Session draft
          </span>
        </div>
        <ol className={s.steps}>
          {(["upload", "story", "preview"] as Stage[]).map((item, index) => (
            <li key={item}>
              <button
                className={stage === item ? s.activeStep : ""}
                disabled={!active && item !== "upload"}
                aria-current={stage === item ? "step" : undefined}
                onClick={() => stageClick(item)}
              >
                <span>
                  {item === "upload" && slides.length ? (
                    <Icon name="check" size={12} />
                  ) : (
                    index + 1
                  )}
                </span>
                {labels[item]}
              </button>
              {index !== 2 && <Icon name="chevron" size={12} />}
            </li>
          ))}
        </ol>
      </div>
      {(error || notice) && (
        <div
          className={`${s.message} ${error ? s.error : ""}`}
          role={error ? "alert" : "status"}
        >
          <Icon name={error ? "alert" : "check"} size={16} />
          <span>{error || notice}</span>
          {undo && !error && (
            <button
              onClick={restoreSlide}
              disabled={slides.length >= MAX_SLIDES}
            >
              Undo removal
            </button>
          )}
          <button
            className={s.iconButton}
            aria-label="Dismiss message"
            onClick={() => {
              setError("");
              setNotice("");
              setUndo(null);
            }}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      <main id="workspace" className={s.workspace}>
        <aside className={s.rail} aria-label="Carousel slides">
          <div className={s.railHeading}>
            <h2>Your slides</h2>
            <span>{String(slides.length).padStart(2, "0")}</span>
          </div>
          <div className={s.slideList}>
            {slides.map((slide, index) => (
              <button
                key={slide.id}
                className={`${s.slide} ${active?.id === slide.id ? s.selectedSlide : ""}`}
                aria-label={`Select slide ${index + 1}: ${slide.name}`}
                aria-pressed={active?.id === slide.id}
                onClick={() => selectSlide(slide.id)}
              >
                <div className={s.slideImage}>
                  <img src={slide.src} alt="" draggable={false} />
                  <span className={s.slideNumber}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {slide.video && (
                    <span className={s.videoMark}>
                      <Icon name="play" size={12} />
                    </span>
                  )}
                </div>
                <strong>{slide.name}</strong>
                <span>
                  {slide.origin === "example" ? "Example" : "Your image"}
                  {slide.video && " · video available"}
                </span>
              </button>
            ))}
          </div>
          <button
            className={s.addSlide}
            onClick={() => input.current?.click()}
            disabled={uploading || slides.length >= MAX_SLIDES}
          >
            <Icon name={uploading ? "image" : "plus"} />
            {uploading ? "Adding images…" : "Add images"}
          </button>
          <p className={s.uploadHint}>
            Drop images anywhere
            <br />
            or paste from your clipboard.
          </p>
          <div className={s.railFooter}>
            <Icon name="lock" size={14} />
            <span>
              Your artwork stays
              <br />
              on this device.
            </span>
          </div>
        </aside>
        <section className={s.canvasColumn} aria-label="Artwork preview">
          {active ? (
            <>
              <div className={s.canvasToolbar}>
                <div>
                  <span className={s.slideLabel}>
                    Slide {String(activeIndex + 1).padStart(2, "0")}
                  </span>
                  <span className={s.sourceLabel}>{active.category}</span>
                </div>
                <div className={s.canvasTools}>
                  <button
                    className={s.iconButton}
                    aria-label="Move slide earlier"
                    disabled={activeIndex === 0}
                    onClick={() =>
                      setSlides((all) => moveSlide(all, active.id, -1))
                    }
                  >
                    <Icon
                      name="arrow"
                      size={16}
                      style={{ transform: "rotate(-90deg)" }}
                    />
                  </button>
                  <button
                    className={s.iconButton}
                    aria-label="Move slide later"
                    disabled={activeIndex === slides.length - 1}
                    onClick={() =>
                      setSlides((all) => moveSlide(all, active.id, 1))
                    }
                  >
                    <Icon
                      name="arrow"
                      size={16}
                      style={{ transform: "rotate(90deg)" }}
                    />
                  </button>
                  <span className={s.toolDivider} />
                  <button
                    className={s.iconButton}
                    aria-label="Remove selected slide"
                    onClick={removeSlide}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              </div>
              <div className={s.canvasMat}>
                <div
                  className={s.viewSwitch}
                  role="group"
                  aria-label="Preview mode"
                >
                  <button
                    className={view === "original" ? s.selectedView : ""}
                    aria-pressed={view === "original"}
                    onClick={() => setView("original")}
                  >
                    Original
                  </button>
                  <button
                    className={view === "video" ? s.selectedView : ""}
                    aria-pressed={view === "video"}
                    disabled={!active.video}
                    title={
                      !active.video
                        ? "No video has been generated for this slide"
                        : "View the existing WAN test clip"
                    }
                    onClick={openPreview}
                  >
                    Video{active.video && <span className={s.smallDot} />}
                  </button>
                  <button
                    className={view === "compare" ? s.selectedView : ""}
                    aria-pressed={view === "compare"}
                    disabled={!active.video}
                    onClick={() => {
                      setView("compare");
                      setStage("preview");
                      setShowRegion(false);
                    }}
                  >
                    Compare
                  </button>
                </div>
                <div
                  className={s.artwork}
                  ref={preview}
                  style={
                    {
                      aspectRatio: `${active.width} / ${active.height}`,
                      "--image-ratio": active.width / active.height,
                    } as React.CSSProperties
                  }
                >
                  <img
                    className={s.sourceImage}
                    src={active.src}
                    alt={active.name}
                    draggable={false}
                  />
                  {videoVisible && (
                    <video
                      ref={video}
                      className={s.video}
                      key={active.id}
                      src={active.video}
                      poster={active.src}
                      playsInline
                      preload="auto"
                      onLoadedData={() => setVideoReady(true)}
                      onError={() => setVideoError(true)}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onEnded={() => setPlaying(false)}
                      onTimeUpdate={(event) =>
                        setCurrentTime(event.currentTarget.currentTime)
                      }
                      aria-label="Previously generated meal-prep sample video"
                    />
                  )}
                  {view === "compare" && (
                    <>
                      <img
                        className={s.compareSource}
                        src={active.src}
                        alt="Original image for comparison"
                        draggable={false}
                        style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}
                      />
                      <div
                        className={s.compareLine}
                        style={{ left: `${compare}%` }}
                      >
                        <span>
                          <Icon
                            name="chevron"
                            size={12}
                            style={{ transform: "rotate(180deg)" }}
                          />
                          <Icon name="chevron" size={12} />
                        </span>
                      </div>
                      <div className={s.compareLabels}>
                        <span>Original</span>
                        <span>Sample video</span>
                      </div>
                    </>
                  )}
                  {view === "original" && showRegion && (
                    <div className={s.regionLayer}>
                      {active.protectedRegions.map((region, index) => (
                        <div
                          key={index}
                          className={s.protectedRegion}
                          style={{
                            left: `${region.x}%`,
                            top: `${region.y}%`,
                            width: `${region.width}%`,
                            height: `${region.height}%`,
                          }}
                          aria-hidden="true"
                        />
                      ))}
                      <div
                        className={`${s.movementRegion} ${overlap ? s.collidingRegion : ""}`}
                        style={{
                          left: `${active.region.x}%`,
                          top: `${active.region.y}%`,
                          width: `${active.region.width}%`,
                          height: `${active.region.height}%`,
                        }}
                        onPointerDown={(event) => startMove(event)}
                        onPointerMove={moveRegion}
                        onPointerUp={() => {
                          movement.current = null;
                        }}
                        onPointerCancel={() => {
                          movement.current = null;
                        }}
                      >
                        <span className={s.regionTag}>
                          <Icon name="move" size={11} />
                          Movement area
                        </span>
                        <button
                          aria-label="Resize movement area"
                          className={s.resizeHandle}
                          onPointerDown={(event) => startMove(event, true)}
                          onPointerMove={moveRegion}
                          onPointerUp={(event) => {
                            event.stopPropagation();
                            movement.current = null;
                          }}
                          onPointerCancel={() => {
                            movement.current = null;
                          }}
                          onKeyDown={(event) => {
                            if (
                              [
                                "ArrowUp",
                                "ArrowDown",
                                "ArrowLeft",
                                "ArrowRight",
                              ].includes(event.key)
                            ) {
                              event.preventDefault();
                              patch({
                                region: {
                                  ...active.region,
                                  width:
                                    active.region.width +
                                    (event.key === "ArrowRight"
                                      ? 1
                                      : event.key === "ArrowLeft"
                                        ? -1
                                        : 0),
                                  height:
                                    active.region.height +
                                    (event.key === "ArrowDown"
                                      ? 1
                                      : event.key === "ArrowUp"
                                        ? -1
                                        : 0),
                                },
                              });
                            }
                          }}
                        >
                          <Icon name="expand" size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className={s.canvasCaption}>
                  <Icon name="image" size={13} />
                  <span>
                    {active.width} × {active.height}
                  </span>
                  <span className={s.captionDivider} />
                  <span>Original proportions</span>
                </div>
              </div>
              {videoVisible ? (
                <div className={s.player}>
                  {videoError ? (
                    <div role="alert">
                      The sample could not be loaded.{" "}
                      <button
                        onClick={() => {
                          setVideoError(false);
                          video.current?.load();
                        }}
                      >
                        Try again
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className={s.playButton}
                        aria-label={
                          playing ? "Pause sample video" : "Play sample video"
                        }
                        onClick={togglePlayback}
                        disabled={!videoReady}
                      >
                        <Icon name={playing ? "pause" : "play"} size={16} />
                      </button>
                      <span className={s.time}>{time(currentTime)}</span>
                      <input
                        type="range"
                        min="0"
                        max="5"
                        step="0.01"
                        value={currentTime}
                        aria-label="Video position"
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          setCurrentTime(next);
                          if (video.current) video.current.currentTime = next;
                        }}
                      />
                      <span className={s.time}>0:05</span>
                      <span className={s.playerSample}>
                        {videoReady ? "Existing sample" : "Loading sample…"}
                      </span>
                    </>
                  )}
                  {view === "compare" && (
                    <label className={s.compareControl}>
                      Compare images
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={compare}
                        aria-label="Original and video comparison"
                        onChange={(event) =>
                          setCompare(Number(event.target.value))
                        }
                      />
                    </label>
                  )}
                </div>
              ) : (
                <div className={s.canvasBottom}>
                  <button
                    className={s.toggleButton}
                    aria-pressed={showRegion}
                    onClick={() => {
                      setShowRegion(!showRegion);
                      if (!showRegion) setPanel("movement");
                    }}
                  >
                    <span
                      className={`${s.toggle} ${showRegion ? s.toggleOn : ""}`}
                      aria-hidden="true"
                    />
                    Show movement area
                  </button>
                  <span>
                    <Icon name="lock" size={13} />
                    {active.protectedRegions.length
                      ? "Text areas marked"
                      : "Text review needed"}
                  </span>
                </div>
              )}
              <p className={s.stageNote}>
                {videoVisible
                  ? "Previously generated sample. Edits to your story or area do not change this clip."
                  : active.origin === "example"
                    ? "Example artwork · Your original is always the starting point."
                    : "Your image · Add a story and review the moving area before creating a video."}
              </p>
            </>
          ) : (
            <div className={s.empty}>
              <div className={s.emptyArt}>
                <Icon name="image" size={42} />
              </div>
              <h1>
                Every image has
                <br />a little story.
              </h1>
              <p>
                Bring yours to life. Start with a finished carousel slide, just
                as you designed it.
              </p>
              <button
                className={s.primary}
                onClick={() => input.current?.click()}
                disabled={uploading}
              >
                <Icon name="upload" />
                Upload your images
              </button>
              <span>PNG, JPG or WebP · up to 25 MB each</span>
              <button
                className={s.textButton}
                onClick={() => library.current?.showModal()}
              >
                Explore the examples <Icon name="arrow" size={15} />
              </button>
            </div>
          )}
        </section>
        <aside className={s.inspector} aria-label="Story and movement controls">
          {active ? (
            stage === "preview" ? (
              <>
                <div className={s.inspectorIntro}>
                  <h1>
                    {active.video
                      ? "A moment,\nin motion."
                      : "Your story,\nready to review."}
                  </h1>
                  <p>
                    {active.video
                      ? "See what a little movement can add to your original artwork."
                      : "Keep the plan with your artwork. Video creation will be connected after this UI review."}
                  </p>
                </div>
                <div className={s.previewDetails}>
                  <span className={s.sectionLabel}>
                    {active.video ? "EXISTING WAN SAMPLE" : "STORY PLAN"}
                  </span>
                  <h2>{active.name}</h2>
                  <p>
                    {active.video
                      ? "She picks up a bite, tastes it, and gives a little smile."
                      : active.story ||
                        "Add a story before exporting this plan."}
                  </p>
                  <dl>
                    <div>
                      <dt>Length</dt>
                      <dd>5 seconds</dd>
                    </div>
                    <div>
                      <dt>Format</dt>
                      <dd>
                        {active.width} × {active.height}
                      </dd>
                    </div>
                    <div>
                      <dt>Sound</dt>
                      <dd>Silent</dd>
                    </div>
                  </dl>
                </div>
                {active.video && (
                  <div className={s.reviewNote}>
                    <Icon name="alert" size={17} />
                    <div>
                      <strong>One detail to refine</strong>
                      <p>
                        Near the end, her hair meets “PART 4” and is clipped by
                        the protected text area. This sample needs another
                        quality pass before publishing.
                      </p>
                    </div>
                  </div>
                )}
                {overlap && (
                  <div className={s.reviewNote} role="alert">
                    Your draft movement area overlaps marked text. Adjust it
                    before exporting the story plan.
                  </div>
                )}
                <div className={s.inspectorFooter}>
                  {active.video && (
                    <a
                      className={s.primary}
                      href={active.video}
                      download="tiny-soho-meal-prep-sample.mp4"
                    >
                      <Icon name="download" size={17} />
                      Download sample video
                    </a>
                  )}
                  <button
                    className={s.secondary}
                    onClick={savePlan}
                    disabled={!active.story.trim() || overlap}
                  >
                    <Icon name="download" size={16} />
                    Download story plan
                  </button>
                  <button
                    className={s.textButton}
                    onClick={() => {
                      setStage("story");
                      setView("original");
                    }}
                  >
                    Back to the story{" "}
                    <Icon
                      name="arrow"
                      size={15}
                      style={{ transform: "rotate(180deg)" }}
                    />
                  </button>
                  <p>
                    The sample is a previous test. No new video has been
                    generated.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className={s.inspectorIntro}>
                  <h1>
                    A little story.
                    <br /> A lasting feeling.
                  </h1>
                  <p>Give this slide a moment of its own.</p>
                </div>
                <div
                  className={s.inspectorTabs}
                  role="group"
                  aria-label="Editing controls"
                >
                  <button
                    className={panel === "story" ? s.activeTab : ""}
                    aria-pressed={panel === "story"}
                    onClick={() => setPanel("story")}
                  >
                    The story
                  </button>
                  <button
                    className={panel === "movement" ? s.activeTab : ""}
                    aria-pressed={panel === "movement"}
                    onClick={() => {
                      setPanel("movement");
                      setShowRegion(true);
                      setView("original");
                    }}
                  >
                    Movement area
                  </button>
                </div>
                {panel === "story" ? (
                  <div className={s.storyControls}>
                    <div className={s.sectionHeading}>
                      <h2>
                        {active.suggestions.length
                          ? "Choose a direction"
                          : "What happens next?"}
                      </h2>
                      {active.suggestions.length > 0 && (
                        <span>Example ideas</span>
                      )}
                    </div>
                    {active.suggestions.length > 0 ? (
                      <div className={s.storyChoices}>
                        {active.suggestions.map((choice, index) => (
                          <button
                            key={choice.id}
                            className={
                              active.selectedStory === choice.id
                                ? s.chosenStory
                                : ""
                            }
                            aria-pressed={active.selectedStory === choice.id}
                            onClick={() =>
                              patch({
                                story: choice.prompt,
                                selectedStory: choice.id,
                              })
                            }
                          >
                            <span className={s.choiceNumber}>{index + 1}</span>
                            <span>{choice.title}</span>
                            <span className={s.choiceRadio}>
                              {active.selectedStory === choice.id && <span />}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={s.manualNote}>
                        Write a small action with a beginning and a reaction.
                        Image analysis is not connected in this preview.
                      </p>
                    )}
                    <label className={s.storyLabel} htmlFor="story">
                      The five-second story <Icon name="edit" size={13} />
                    </label>
                    <textarea
                      id="story"
                      ref={storyInput}
                      className={s.storyText}
                      rows={5}
                      maxLength={1500}
                      value={active.story}
                      placeholder="For example: they exchange a glance, pass the flower, then share a small smile…"
                      onChange={(event) =>
                        patch({ story: event.target.value, selectedStory: "" })
                      }
                    />
                    <div className={s.storyMeta}>
                      <span>Make it your own.</span>
                      <span>{active.story.length}/1500</span>
                    </div>
                    <div className={s.directionDetails}>
                      <div>
                        <span>Duration</span>
                        <strong>5 seconds</strong>
                      </div>
                      <div>
                        <span>Pace</span>
                        <strong>Natural</strong>
                      </div>
                      <div>
                        <span>Camera</span>
                        <strong>Still</strong>
                      </div>
                    </div>
                    <button
                      className={s.protectionLink}
                      onClick={() => {
                        setPanel("movement");
                        setShowRegion(true);
                      }}
                    >
                      <span className={s.lockCircle}>
                        <Icon name="lock" size={17} />
                      </span>
                      <span>
                        <strong>Keep the design intact</strong>
                        <small>
                          {active.protectedRegions.length
                            ? "Review the marked text and moving area."
                            : "Choose where the action can happen."}
                        </small>
                      </span>
                      <Icon name="chevron" size={15} />
                    </button>
                  </div>
                ) : (
                  <div className={s.movementControls}>
                    <div className={s.sectionHeading}>
                      <h2>Room for the action</h2>
                      <Icon name="move" size={16} />
                    </div>
                    <p>
                      Drag the outlined area over the part that can move. Use
                      its corner to resize, or adjust the sliders below.
                    </p>
                    {(["x", "y", "width", "height"] as const).map((key) => (
                      <label className={s.regionSlider} key={key}>
                        <span>
                          {
                            {
                              x: "Left",
                              y: "Top",
                              width: "Width",
                              height: "Height",
                            }[key]
                          }
                          <output>{Math.round(active.region[key])}%</output>
                        </span>
                        <input
                          type="range"
                          min={key === "width" || key === "height" ? 5 : 0}
                          max={
                            key === "width"
                              ? 100 - active.region.x
                              : key === "height"
                                ? 100 - active.region.y
                                : key === "x"
                                  ? 100 - active.region.width
                                  : 100 - active.region.height
                          }
                          value={active.region[key]}
                          aria-label={`Movement area ${key}`}
                          onChange={(event) =>
                            patch({
                              region: {
                                ...active.region,
                                [key]: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                    <button
                      className={s.textButton}
                      onClick={() =>
                        patch({
                          region: exampleSlides().find(
                            (slide) => slide.id === active.id,
                          )?.region ?? { ...INITIAL_REGION },
                        })
                      }
                    >
                      <Icon name="undo" size={14} />
                      Reset area
                    </button>
                    <div
                      className={`${s.regionStatus} ${overlap ? s.regionWarning : ""}`}
                      role="status"
                    >
                      <Icon
                        name={
                          overlap
                            ? "alert"
                            : active.protectedRegions.length
                              ? "lock"
                              : "help"
                        }
                        size={17}
                      />
                      <div>
                        <strong>
                          {overlap
                            ? "This area overlaps text"
                            : active.protectedRegions.length
                              ? "Marked text is outside this area"
                              : "Review your text carefully"}
                        </strong>
                        <p>
                          {overlap
                            ? "Move or shrink the area to leave breathing room around the words."
                            : active.protectedRegions.length
                              ? "Leave room for hair, hands and the full action. The example markings are manually prepared."
                              : "Automatic text detection is not connected. Keep the moving area away from all text and branding."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <div className={s.inspectorFooter}>
                  <button
                    className={s.primary}
                    onClick={openPreview}
                    disabled={!active.story.trim() || overlap}
                  >
                    {active.video ? (
                      <Icon name="play" size={16} />
                    ) : (
                      <Icon name="check" size={16} />
                    )}{" "}
                    {active.video
                      ? "Preview sample video"
                      : "Review story plan"}
                    <Icon name="arrow" size={17} />
                  </button>
                  <p>
                    {active.video
                      ? "Explore the existing test clip. No new generation."
                      : "Live generation will follow this UI review."}
                  </p>
                </div>
              </>
            )
          ) : (
            <div className={s.inspectorEmpty}>
              <Icon name="layers" size={24} />
              <h2>Your story starts here.</h2>
              <p>Upload an image to choose its action and movement area.</p>
            </div>
          )}
        </aside>
      </main>
      <footer className={s.footer}>
        <span>
          Tiny Soho Studio
          <span className={s.footerDot} />
          Thoughtfully made, frame by frame.
        </span>
        <span>
          Images stay local
          <span className={s.footerDot} />
          {onOpenTools ? (
            <button className={s.toolsLink} onClick={onOpenTools}>
              Open existing tools <Icon name="arrow" size={12} />
            </button>
          ) : (
            <a href="/legacy">Open previous studio <Icon name="arrow" size={12} /></a>
          )}
        </span>
      </footer>
      {dragging && (
        <div className={s.dropOverlay}>
          <Icon name="upload" size={38} />
          <h2>Drop a little inspiration.</h2>
          <p>Your images will keep their original proportions.</p>
        </div>
      )}
      <dialog
        className={s.dialog}
        ref={library}
        aria-labelledby="library-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) library.current?.close();
        }}
      >
        <div className={s.dialogHeader}>
          <div>
            <h2 id="library-title">A few stories to begin with.</h2>
            <p>Three independent examples. Choose one to explore.</p>
          </div>
          <button
            className={s.iconButton}
            aria-label="Close example library"
            onClick={() => library.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className={s.libraryGrid}>
          {exampleSlides().map((slide) => (
            <button key={slide.id} onClick={() => addExample(slide.id)}>
              <img src={slide.src} alt={slide.name} />
              <strong>{slide.name}</strong>
              <span>
                {slide.category}
                {slide.video
                  ? " · includes sample video"
                  : " · story plan only"}
              </span>
              <span className={s.libraryAction}>
                Open example <Icon name="arrow" size={16} />
              </span>
            </button>
          ))}
        </div>
      </dialog>
      <dialog
        className={`${s.dialog} ${s.helpDialog}`}
        ref={help}
        aria-labelledby="help-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) help.current?.close();
        }}
      >
        <div className={s.dialogHeader}>
          <h2 id="help-title">A studio taking shape.</h2>
          <button
            className={s.iconButton}
            aria-label="Close preview information"
            onClick={() => help.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <p>
          This is the interactive UI preview of Carousel Studio. Upload or paste
          an image, edit its story, and review where the action can happen.
        </p>
        <ul>
          <li>
            The three example stories and text areas are manually prepared.
          </li>
          <li>
            The meal-prep video is the existing WAN test. Editing its story or
            area does not regenerate it.
          </li>
          <li>
            Your images stay in this browser session. Download story plans to
            keep your work; refreshing resets the workspace.
          </li>
          <li>
            Live image analysis, text protection and video generation are not
            connected to this screen yet.
          </li>
        </ul>
        <button className={s.primary} onClick={() => help.current?.close()}>
          Back to the studio <Icon name="arrow" size={16} />
        </button>
      </dialog>
    </div>
  );
}
