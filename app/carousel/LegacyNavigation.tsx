"use client";
import { usePathname } from "next/navigation";
export default function LegacyNavigation() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <nav
      aria-label="Legacy studio navigation"
      style={{
        position: "fixed",
        right: 18,
        bottom: 16,
        display: "flex",
        gap: 8,
      }}
    >
      {[
        ["/", "Carousel Studio"],
        ["/legacy", "Previous studio"],
        ["/storyboard", "Storyboard"],
        ["/director", "Director"],
      ].map(([href, label]) => (
        <a
          key={href}
          href={href}
          style={{
            borderRadius: 8,
            background: "#171a20",
            color: "white",
            padding: "9px 13px",
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
