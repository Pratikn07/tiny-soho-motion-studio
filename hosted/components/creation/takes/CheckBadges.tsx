import type { TakeView } from "@/lib/contract";
import s from "./takes.module.css";
export function CheckBadges({
  take,
  hasText,
}: {
  take: TakeView;
  hasText: boolean;
}) {
  if (take.verdict === "pending")
    return <p className={s.muted}>Checks are still running.</p>;
  if (take.verdict === "rejected")
    return (
      <div className={s.failed}>
        {(take.checks?.reasons.length
          ? take.checks.reasons
          : ["This take needs a look."]
        ).map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
      </div>
    );
  return (
    <ul className={s.badges} aria-label="Automatic checks">
      <li>Camera steady</li>
      {hasText && <li>Text clear</li>}
      <li>Loops smoothly</li>
    </ul>
  );
}
