import type { ComponentType } from "react";

import type { CreationView, SlideV2 } from "@/lib/contract";
import type { CreationApi } from "./api";
import type { DocumentEdit } from "./useCreation";
import { ModelPanel } from "./model/ModelPanel";
import { MotionPanel } from "./motion/MotionPanel";
import { TextAnimationPanel } from "./text-animation/TextAnimationPanel";

/**
 * Slots in the creation page. Each later task adds its panel with one line here and keeps its code in its own
 * folder: motion/ and model/ (U2), text-animation/ (U4), takes/ and export/ (U3), budget/ (O1).
 */
export type SlidePanelProps = {
  creation: CreationView;
  slide: SlideV2;
  /** Whether the slide's layers are uploaded and passed their checks. */
  ready: boolean;
  api: CreationApi;
  /** Applies a change to the document and autosaves it. */
  edit: (change: DocumentEdit) => void;
  /** Changes only this slide. */
  editSlide: (change: (slide: SlideV2) => SlideV2) => void;
};

export type SlidePanel = { id: string; title: string; Component: ComponentType<SlidePanelProps> };

/** Panels in the slide inspector, top to bottom. */
export const SLIDE_PANELS: SlidePanel[] = [
  { id: "motion", title: "Motion", Component: MotionPanel }, // U2
  { id: "model", title: "Video model", Component: ModelPanel }, // U2
  { id: "text-animation", title: "Text animation", Component: TextAnimationPanel }, // U4
];

export type ToolbarItemProps = { api: CreationApi; creation: CreationView | null };

/** Small items in the creation bar, next to the save state (for example O1's budget). */
export const TOOLBAR_ITEMS: Array<{ id: string; Component: ComponentType<ToolbarItemProps> }> = [];
