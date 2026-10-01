"use client";

import { useState, type ReactNode } from "react";

import type { SlideV2 } from "@/lib/contract";
import { SlideCard } from "./SlideCard";
import type { SlideUpload } from "./useUploads";
import u from "./upload.module.css";

type Props = {
  slides: SlideV2[];
  selectedId: string | null;
  uploads: Record<string, SlideUpload>;
  previews: Record<string, { background: string | null; text: string | null }>;
  onSelect: (slideId: string) => void;
  /** Moves a slide to a new position in carousel order. */
  onMove: (slideId: string, to: number) => void;
  onRetry: (slideId: string) => void;
  addControl?: ReactNode;
};

/** The carousel in order. Drag a card, or press Alt + an arrow key on it, to reorder. */
export function SlideRail({ slides, selectedId, uploads, previews, onSelect, onMove, onRetry, addControl }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  return (
    <nav className={u.rail} aria-label="Slides">
      <p id="slide-reorder-hint" className={u.visuallyHidden}>Drag to reorder, or press Alt and an arrow key.</p>
      <ol className={u.railList} aria-label="Slides in carousel order">
        {slides.map((slide, position) => (
          <SlideCard
            key={slide.id}
            slide={slide}
            position={position}
            total={slides.length}
            selected={slide.id === selectedId}
            upload={uploads[slide.id]}
            preview={previews[slide.id] ?? { background: null, text: null }}
            onSelect={() => onSelect(slide.id)}
            onMove={(to) => onMove(slide.id, to)}
            onRetry={() => onRetry(slide.id)}
            dragging={dragging === slide.id}
            onDragStart={() => setDragging(slide.id)}
            onDragEnter={() => {
              if (dragging && dragging !== slide.id) onMove(dragging, position);
            }}
            onDragEnd={() => setDragging(null)}
          />
        ))}
      </ol>
      {addControl}
    </nav>
  );
}
