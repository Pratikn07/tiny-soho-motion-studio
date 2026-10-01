import type { UploadCheckResult } from "@/lib/contract";
import Icon from "@/components/carousel/Icons";
import u from "./upload.module.css";

/** B2's upload checks in plain words: errors block the slide, warnings say what will be fixed automatically. */
export function UploadChecks({ checks, compact = false }: { checks?: UploadCheckResult; compact?: boolean }) {
  if (!checks) return null;
  const errors = checks.items.filter((item) => item.severity === "error");
  const warnings = checks.items.filter((item) => item.severity === "warning");
  const notes = checks.items.filter((item) => item.severity === "info");
  if (!checks.items.length) {
    return <p className={`${u.checksOk} ${compact ? u.checksCompact : ""}`}><Icon name="check" size={14} /> Both layers look right.</p>;
  }
  return (
    <div className={`${u.checks} ${compact ? u.checksCompact : ""}`}>
      {errors.length > 0 && (
        <section className={u.checksError} aria-label="Problems to fix">
          <h3><Icon name="alert" size={14} /> {errors.length === 1 ? "Fix this before it can move" : "Fix these before it can move"}</h3>
          <ul>{errors.map((item) => <li key={item.code}>{item.message}</li>)}</ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section className={u.checksWarning} aria-label="Fixed automatically">
          <h3>Fixed automatically</h3>
          <ul>{warnings.map((item) => <li key={item.code}>{item.message}</li>)}</ul>
        </section>
      )}
      {notes.length > 0 && (
        <section className={u.checksNote} aria-label="Notes">
          <ul>{notes.map((item) => <li key={item.code}>{item.message}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
