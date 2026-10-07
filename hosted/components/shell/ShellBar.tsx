"use client";

import { useEffect, useRef, useState } from "react";

import { SECTIONS, type SectionId } from "./sections";
import s from "./shell.module.css";

export type MacState = "not-set-up" | "online" | "asleep";

const MAC_LABEL: Record<MacState, string> = {
  "not-set-up": "Studio Mac · not set up",
  online: "Studio Mac · online",
  asleep: "Studio Mac · asleep",
};

const MAC_STATUS: Record<MacState, string> = {
  "not-set-up": "Not connected yet. Reel jobs will run on your Mac once its runner is installed.",
  online: "Online. Reel jobs start right away.",
  asleep: "Asleep. Reel jobs wait in the queue and start when it wakes.",
};

/** The Studio Mac runner's status: where reel jobs run, and with which Claude login. */
export function StudioMacChip({ state = "not-set-up" }: { state?: MacState }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className={s.mac} ref={box}>
      <button
        type="button"
        className={s.chip}
        aria-expanded={open}
        aria-controls="studio-mac-status"
        aria-label={MAC_LABEL[state]}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={s.dot} data-state={state} aria-hidden="true" />
        <span className={s.chipLabel}>{MAC_LABEL[state]}</span>
      </button>
      {open && (
        <div className={s.pop} id="studio-mac-status" role="dialog" aria-label="Studio Mac">
          <span className={s.eyebrow}>Studio Mac</span>
          <dl className={s.facts}>
            <dt>Status</dt><dd>{MAC_STATUS[state]}</dd>
            <dt>Runs</dt><dd>Reel scripts, scenes and renders</dd>
            <dt>Claude login</dt><dd>Your subscription, switchable to an API key when creators join</dd>
          </dl>
          <p>Keep the Mac plugged in and awake while reels are being made.</p>
        </div>
      )}
    </div>
  );
}

/** The Studio's top bar: wordmark, the four sections, the Studio Mac status, tools and sign out. */
export function ShellBar({ section, onSection, onSignOut, macState }: {
  section: SectionId;
  onSection: (section: SectionId) => void;
  onSignOut?: () => void;
  macState?: MacState;
}) {
  return (
    <div className={s.bar}>
      <a href="#carousels" className={s.wordmark} aria-label="Tiny Soho Studio" onClick={(event) => { event.preventDefault(); onSection("carousels"); }}>
        tiny soho<span>STUDIO</span>
      </a>
      <nav className={s.sections} aria-label="Studio sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={s.section}
            aria-current={item.id === section ? "page" : undefined}
            onClick={() => onSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className={s.end}>
        <StudioMacChip state={macState} />
        <a className={`${s.textButton} ${s.oldStudio}`} href="/?studio=legacy">Old studio</a>
        {onSignOut && <button type="button" className={s.textButton} onClick={onSignOut}>Sign out</button>}
      </div>
    </div>
  );
}
