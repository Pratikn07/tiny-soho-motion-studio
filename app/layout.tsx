import "./globals.css";
import type { Metadata } from "next";
import LegacyNavigation from "./carousel/LegacyNavigation";
export const metadata: Metadata = {
  title: "Tiny Soho Creative Studio",
  description: "Local typography-safe motion studio",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <template
          id="carousel-design-contract"
          dangerouslySetInnerHTML={{
            __html: `<!-- THESIS: Finished artwork leads a creator workspace. OWN-WORLD: Approved light editorial surfaces, Didot titles, near-black controls, fine rules and restrained sage feedback. STORY: Upload, shape a five-second action, review movement, compare and export. FIRST VIEWPORT: Slide rail left, dominant uncropped image centre, story inspector right. FORM: User-approved three-panel editor; seed key user-approved-carousel-2026-09-27. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->`,
          }}
        />
        {children}
        <style>{`.board{max-width:980px;margin:0 auto;padding:48px 24px}.board>a{color:#2757cf;font-weight:700}.board h1{margin-top:18px}.board>p{color:#77746f;max-width:700px}.board>label{display:grid;gap:6px;max-width:460px;margin:24px 0;font-size:12px;font-weight:800}.board select,.board textarea{padding:10px;border:1px solid #ddd7cd;border-radius:8px;font:inherit}.board textarea{min-height:100px}.board-form{display:grid;grid-template-columns:1fr 1fr;gap:14px;background:#fffdf8;border:1px solid #ddd7cd;border-radius:14px;padding:20px}.board-form label:last-of-type{grid-column:1/-1}.board-form button,.batch{border:0;border-radius:9px;padding:12px;background:#2757cf;color:#fff;font-weight:800;cursor:pointer}.board-notice{padding:10px;background:#e8edff;border-radius:8px}.board ol{list-style:none;padding:0}.board li{display:grid;grid-template-columns:110px 1fr 180px 36px 36px;gap:10px;align-items:center;border-top:1px solid #ddd7cd;padding:14px 0;font-size:13px}.board li small{color:#77746f}.board li button{border:1px solid #ddd7cd;background:#fff;border-radius:5px;padding:5px;cursor:pointer}.director-card{margin-top:20px}.director-card pre{white-space:pre-wrap;background:#24221f;color:#f5f2ec;padding:16px;border-radius:10px;font-size:12px;overflow:auto}@media(max-width:650px){.board-form{grid-template-columns:1fr}.board li{grid-template-columns:1fr}.board li button{width:36px}}`}</style>
        <LegacyNavigation />
      </body>
    </html>
  );
}
