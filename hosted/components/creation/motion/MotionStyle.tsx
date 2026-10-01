import type { MotionStyle as Style } from "@/lib/contract";
import m from "./motion.module.css";

const OPTIONS: Array<{ value: Style; label: string; detail: string }> = [
  { value: "calm", label: "Calm", detail: "Small, natural movement. The subject stays where it is, so your text stays clear." },
  { value: "lively", label: "Lively", detail: "Bigger movement and expression. It may cross your text." },
];

/** Calm or Lively in words; the end-frame strength behind it (0.6 / 0.4) is never shown. */
export function MotionStyle({ value, onChange, crowded, slideId }: {
  value: Style;
  onChange: (style: Style) => void;
  /** The review found the subject within about 8% of the text, where Lively crossed it in testing. */
  crowded: boolean;
  slideId: string;
}) {
  return (
    <fieldset className={m.style}>
      <legend>How much movement</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className={`${m.styleOption} ${value === option.value ? m.styleSelected : ""}`}>
          <input type="radio" name={`motion-style-${slideId}`} value={option.value} checked={value === option.value}
            onChange={() => onChange(option.value)} />
          <span>
            <strong>{option.label}{option.value === "calm" ? " (recommended)" : ""}</strong>
            <span>{option.detail}</span>
          </span>
        </label>
      ))}
      {crowded && value === "lively" && (
        <p className={m.styleWarning}>On this slide the subject is close to your words, so Lively is likely to cross them.</p>
      )}
    </fieldset>
  );
}
