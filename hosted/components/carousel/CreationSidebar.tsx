"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CarouselCreationSummary } from "../../lib/carousel-creations";
import Icon from "./Icons";
import c from "./creation.module.css";

type Props = {
  creations: Array<CarouselCreationSummary & { slidesInProgress?: number; archivedAt?: string | null }>;
  activeId: string | null;
  busy: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename?: (id: string, name: string) => Promise<void>;
  onArchive?: (id: string, archived: boolean) => Promise<void>;
  thumbnails?: Record<string, string>;
};

export function CreationSidebar({ creations, activeId, busy, onNew, onOpen, onRename, onArchive, thumbnails }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
  const navigate = (action: () => void) => {
    action(); setOpen(false);
    requestAnimationFrame(() => document.getElementById("creation-main")?.focus());
  };
  useLayoutEffect(() => {
    if (!open) return;
    const background = Array.from(sidebar.current?.parentElement?.children ?? [])
      .filter((item): item is HTMLElement => item instanceof HTMLElement && item !== sidebar.current && !item.classList.contains(c.scrim));
    const previous = background.map(item => ({ item, inert: item.inert }));
    background.forEach(item => { item.inert = true; });
    const focusFrame = requestAnimationFrame(() => closeButton.current?.focus());
    // Visibility transitions can defer focus until the drawer has entered the viewport.
    const focusAfterEntry = window.setTimeout(() => {
      if (!sidebar.current?.contains(document.activeElement)) closeButton.current?.focus();
    }, 220);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), summary, a[href], select:not(:disabled)',
      ) ?? []).filter(item => !item.closest("details:not([open])") || item.tagName === "SUMMARY");
      if (!controls.length) return;
      if (!sidebar.current?.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      } else if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault(); controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault(); controls[0].focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { cancelAnimationFrame(focusFrame); window.clearTimeout(focusAfterEntry); window.removeEventListener("keydown", onKeyDown); previous.forEach(({item,inert}) => { item.inert = inert; }); };
  }, [open]);

  const perform = async (action: () => Promise<void>) => {
    setSaving(true); setError("");
    try { await action(); setRenaming(null); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't save that change. Try again."); }
    finally {
      setSaving(false);
      requestAnimationFrame(() => {
        if (open && !sidebar.current?.contains(document.activeElement)) closeButton.current?.focus();
      });
    }
  };
  const visible = creations.filter(item => (!item.archivedAt || archived) && item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <>
    <button ref={trigger} className={c.historyTrigger} aria-expanded={open} aria-controls="creation-history" onClick={() => setOpen(true)}>
      <Icon name="layers" size={16} /> Creations
    </button>
    {open && <div className={c.scrim} aria-hidden="true" onClick={close} />}
    <aside ref={sidebar} id="creation-history" className={`${c.sidebar} ${open ? c.sidebarOpen : ""}`}
      role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-label="Your creations" aria-busy={busy}>
      <div className={c.sidebarHead}><span>YOUR STUDIO</span><button ref={closeButton} className={c.closeHistory} aria-label="Close creations" onClick={close}><Icon name="close" size={18} /></button></div>
      <button className={`${c.newButton} ${!activeId ? c.newButtonActive : ""}`} aria-current={!activeId ? "page" : undefined} onClick={() => navigate(onNew)}>
        <Icon name="plus" size={17} /> New creation
      </button>
      <div className={c.historyLabel}><span>RECENT CREATIONS</span><span>{visible.length}</span></div>
      <input className={c.search} type="search" aria-label="Search creations" placeholder="Search creations…" value={search} onChange={event => setSearch(event.target.value)} />
      {onArchive && <label className={c.archiveToggle}><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Show archived creations</label>}
      {error && <p className={c.historyError} role="alert">{error}</p>}
      {visible.length ? <nav aria-label="Saved creations" className={c.creationList}>
        {visible.map(creation => <div className={c.historyRow} key={creation.id}>
          <button aria-label={creation.name} aria-current={activeId === creation.id ? "page" : undefined}
            className={`${c.creation} ${activeId === creation.id ? c.creationActive : ""}`} onClick={() => navigate(() => onOpen(creation.id))}>
            <span className={c.creationMark}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumbnails?.[creation.id] ? <img src={thumbnails[creation.id]} alt="" loading="lazy" /> : <Icon name="image" size={16} />}
            </span>
            <span className={c.creationDetails}><strong>{creation.name}</strong>
              <small>{creation.slideCount} {creation.slideCount === 1 ? "slide" : "slides"} · {new Date(creation.updatedAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</small>
              {Boolean(creation.slidesInProgress) && <small>{creation.slidesInProgress} {creation.slidesInProgress === 1 ? "slide" : "slides"} in progress</small>}
              {creation.archivedAt && <small>Archived</small>}
            </span>
          </button>
          {(onRename || onArchive) && <details className={c.historyOptions}>
            <summary aria-label={`Options for ${creation.name}`}><span className={c.visuallyHidden}>Options for {creation.name}</span>···</summary>
            <div className={c.historyActions}>
              {onRename && <button disabled={saving} onClick={() => {setRenaming(creation.id);setName(creation.name);}}>Rename</button>}
              {onArchive && <button disabled={saving} onClick={() => void perform(() => onArchive(creation.id,!creation.archivedAt))}>{creation.archivedAt ? "Restore" : "Archive"}</button>}
              {Boolean(creation.slidesInProgress) && <small>Archiving does not cancel generation.</small>}
            </div>
          </details>}
          {renaming === creation.id && <form className={c.renameForm} onSubmit={event => {event.preventDefault();if(name.trim() && onRename) void perform(() => onRename(creation.id,name.trim()));}}>
            <input autoFocus aria-label="New creation name" maxLength={160} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => {if(event.key === "Escape"){event.stopPropagation();setRenaming(null);}}} />
            <button disabled={saving || !name.trim()} type="submit">Save name</button><button type="button" onClick={() => setRenaming(null)}>Cancel</button>
          </form>}
        </div>)}
      </nav> : <p className={c.noCreations}>{search.trim() ? "No creations match your search." : creations.some(item => item.archivedAt)
        ? "No active creations. Show archived creations to restore one." : "Your saved creations will appear here once you add an image."}</p>}
      <p className={c.sidebarFoot}>A quiet space for every little story.</p>
    </aside>
  </>;
}
