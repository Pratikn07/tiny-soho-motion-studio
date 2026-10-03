"use client";

import { useState } from "react";

import type { MotionSuggestion } from "@/lib/contract";
import Icon from "@/components/carousel/Icons";
import { readRisk } from "./client";
import m from "./motion.module.css";

const LEVEL_LABEL = { safe: "Lower overlap risk", "some risk": "Some risk", risky: "Risky" } as const;

/** One suggested motion. The model prompt stays behind "Show details". */
export function SuggestionCard({ suggestion, index, selected, onChoose, group }: {
  suggestion: MotionSuggestion;
  index: number;
  group: string;
  selected: boolean;
  onChoose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const risk = readRisk(suggestion.risk);
  const id = `${group}-${index}`;
  return (
    <li className={`${m.suggestion} ${selected ? m.suggestionSelected : ""}`}>
      <label className={m.suggestionPick}>
        <input type="radio" name={group} checked={selected} onChange={onChoose} aria-describedby={`${id}-story ${id}-risk`} />
        <span className={m.suggestionText}>
          <strong>{suggestion.title}</strong>
          <span id={`${id}-story`} className={m.story}>{suggestion.story}</span>
          <span id={`${id}-risk`} className={`${m.risk} ${m[`risk_${risk.level.replace(" ", "_")}`]}`}>
            {risk.level === "safe" ? <Icon name="check" size={12} /> : <Icon name="alert" size={12} />}
            {LEVEL_LABEL[risk.level]}{risk.reason ? `: ${risk.reason}` : ""}
          </span>
        </span>
      </label>
      <button className={m.details} aria-expanded={open} aria-controls={`${id}-prompt`} onClick={() => setOpen(!open)}>
        {open ? "Hide details" : "Show details"}
      </button>
      {open && <p id={`${id}-prompt`} className={m.prompt}>{suggestion.prompt}</p>}
    </li>
  );
}
