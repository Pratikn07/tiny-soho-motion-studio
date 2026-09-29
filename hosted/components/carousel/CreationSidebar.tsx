"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CarouselCreationSummary } from "../../lib/carousel-creations";
import Icon from "./Icons";
import c from "./creation.module.css";

type Props = {
  creations: CarouselCreationSummary[];
  activeId: string | null;
  busy: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
};

export function CreationSidebar({
  creations,
  activeId,
  busy,
  onNew,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const controls = Array.from(
        sidebar.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? [],
      );
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        className={c.historyTrigger}
        aria-expanded={open}
        aria-controls="creation-history"
        onClick={() => setOpen(true)}
      >
        <Icon name="layers" size={16} /> Creations
      </button>
      {open && <div className={c.scrim} aria-hidden="true" onClick={close} />}
      <aside
        ref={sidebar}
        id="creation-history"
        className={`${c.sidebar} ${open ? c.sidebarOpen : ""}`}
        aria-label="Your creations"
        aria-busy={busy}
      >
        <div className={c.sidebarHead}>
          <span>YOUR STUDIO</span>
          <button
            ref={closeButton}
            className={c.closeHistory}
            aria-label="Close creations"
            onClick={close}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <button
          className={`${c.newButton} ${!activeId ? c.newButtonActive : ""}`}
          aria-current={!activeId ? "page" : undefined}
          onClick={() => {
            onNew();
            setOpen(false);
          }}
        >
          <Icon name="plus" size={17} /> New creation
        </button>
        <div className={c.historyLabel}>
          <span>RECENT CREATIONS</span>
          <span>{creations.length}</span>
        </div>
        {creations.length ? (
          <nav aria-label="Saved creations" className={c.creationList}>
            {creations.map((creation) => (
              <button
                key={creation.id}
                aria-label={creation.name}
                aria-current={activeId === creation.id ? "page" : undefined}
                className={`${c.creation} ${activeId === creation.id ? c.creationActive : ""}`}
                onClick={() => {
                  onOpen(creation.id);
                  setOpen(false);
                }}
              >
                <span className={c.creationMark}>
                  <Icon name="image" size={16} />
                </span>
                <span className={c.creationDetails}>
                  <strong>{creation.name}</strong>
                  <small>
                    {creation.slideCount} {creation.slideCount === 1 ? "slide" : "slides"} ·{" "}
                    {new Date(creation.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </small>
                </span>
              </button>
            ))}
          </nav>
        ) : (
          <p className={c.noCreations}>
            Your saved creations will appear here once you add an image.
          </p>
        )}
        <p className={c.sidebarFoot}>A quiet space for every little story.</p>
      </aside>
    </>
  );
}
