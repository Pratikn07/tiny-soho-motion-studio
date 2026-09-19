import type { MotionPackage } from "./motion-package";

export function buildWanCompatiblePrompt(pkg: MotionPackage): string {
  const subject = pkg.plan.final!.subject;
  const camera = pkg.plan.final!.camera;
  return [
    "Animate the supplied clean background only.",
    `Apply subject motion x=${subject.x.toFixed(3)}, y=${subject.y.toFixed(3)} and camera motion x=${camera.x.toFixed(3)}, y=${camera.y.toFixed(3)}.`,
    "Preserve the source composition and protected layout.",
    "Do not generate, alter, or redraw text, logos, captions, or typography.",
    "Typography is composited locally from the trusted overlay after generation.",
  ].join(" ");
}
