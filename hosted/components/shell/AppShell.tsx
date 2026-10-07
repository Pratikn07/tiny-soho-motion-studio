"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { DEFAULT_SECTION, sectionFromHash, type SectionId } from "./sections";
import { ShellBar, type MacState } from "./ShellBar";
import s from "./shell.module.css";

/**
 * The Studio's sections: Reels, Carousels, Library and Creations. Carousels renders the existing creation page,
 * which receives the shell's bar as its own top bar (`carousels(bar)`) so its layout is unchanged. The other
 * sections show what they will hold until their screens are built. The section is kept in the URL hash.
 */
export function AppShell({ carousels, onSignOut, macState = "not-set-up" }: {
  carousels: (bar: ReactNode) => ReactNode;
  onSignOut?: () => void;
  macState?: MacState;
}) {
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  useEffect(() => {
    const read = () => setSection(sectionFromHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = useCallback((next: SectionId) => {
    setSection(next);
    if (window.location.hash !== `#${next}`) window.history.replaceState(null, "", `#${next}`);
  }, []);

  const bar = <ShellBar section={section} onSection={go} onSignOut={onSignOut} macState={macState} />;
  if (section === "carousels") return <>{carousels(bar)}</>;
  return (
    <div className={s.page}>
      <header className={s.pageHeader}>{bar}</header>
      <main className={s.pageBody} id="studio-main">
        {section === "reels" && <ReelsSection />}
        {section === "library" && <LibrarySection />}
        {section === "creations" && <CreationsSection onCarousels={() => go("carousels")} />}
      </main>
    </div>
  );
}

const REEL_STEPS: Array<[string, string]> = [
  ["Idea", "Pick the story"],
  ["Script", "Lines, voice cues, visuals"],
  ["Storyboard", "One still per scene"],
  ["Voice", "Your voice, two takes"],
  ["Images", "Only what the story needs"],
  ["Build", "Scenes on the Studio Mac"],
  ["Sound", "Score, effects, mix"],
  ["Export", "The 9:16 reel"],
];

function ReelsSection() {
  return (
    <>
      <div>
        <span className={`${s.badge} ${s.badgeSoon}`}>Coming next</span>
        <h1>Story reels, made step by step.</h1>
        <p className={s.lede}>
          Motion-graphics reels built by Claude Code on your Studio Mac, in your voice, with images generated only
          where the story needs them. You approve each step before the next one starts.
        </p>
      </div>
      <ol className={s.steps} aria-label="Reel steps">
        {REEL_STEPS.map(([name, detail]) => <li key={name}><b>{name}</b><span>{detail}</span></li>)}
      </ol>
      <p className={s.note}>Reels need the Studio Mac runner and a place to save reel jobs. Both are being built next.</p>
    </>
  );
}

function LibrarySection() {
  const items: Array<[string, string]> = [
    ["Cast", "Anaika and Bhagyashree, with their character references."],
    ["Brand kit", "Fonts, colours and the Tiny Soho lockup for reels."],
    ["Voice", "Your cloned voice and its delivery settings."],
    ["Music and sound", "Scores and sound effects you can reuse."],
    ["Storytelling library", "Hooks, structures and endings from your saved reels."],
  ];
  return (
    <>
      <div>
        <span className={`${s.badge} ${s.badgeSoon}`}>Coming next</span>
        <h1>One library for reels and carousels.</h1>
        <p className={s.lede}>Everything both sections reuse, in one place.</p>
      </div>
      <div className={s.cards}>
        {items.map(([title, detail]) => <section key={title} className={s.card}><h2>{title}</h2><p>{detail}</p></section>)}
      </div>
    </>
  );
}

function CreationsSection({ onCarousels }: { onCarousels: () => void }) {
  return (
    <>
      <div>
        <span className={`${s.badge} ${s.badgeLive}`}>Carousels today</span>
        <h1>Everything you&rsquo;ve made.</h1>
        <p className={s.lede}>
          Reels and carousels will be listed here together. For now, your carousels are in the Carousels section&rsquo;s
          sidebar.
        </p>
      </div>
      <div>
        <button type="button" className={s.textButton} onClick={onCarousels}>Open Carousels</button>
      </div>
    </>
  );
}
