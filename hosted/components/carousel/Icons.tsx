import type { CSSProperties } from "react";
export type IconName =
  | "plus"
  | "upload"
  | "arrow"
  | "chevron"
  | "check"
  | "lock"
  | "play"
  | "pause"
  | "download"
  | "image"
  | "layers"
  | "close"
  | "trash"
  | "help"
  | "move"
  | "undo"
  | "grid"
  | "expand"
  | "edit"
  | "alert";
const paths: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
    </>
  ),
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7Z" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  download: <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 5-5 4 4 3-7 6 8" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01" />
    </>
  ),
  move: (
    <path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4" />
  ),
  undo: <path d="M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />,
  edit: (
    <>
      <path d="m4 16-1 5 5-1L20 8l-4-4ZM14 6l4 4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 21h20ZM12 9v5m0 3v.01" />
    </>
  ),
};
export default function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
