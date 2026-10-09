// Are.na boards as references: the creator saves pins into a channel (one per series works well) and pastes its link
// in Studio. The Studio Mac reads the channel with the Are.na CLI (signed in on this Mac as the creator), downloads
// medium-size copies of its images into the job's folder, and Claude looks at them with the motion library.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Images per board the Mac downloads; enough to read a mood without slowing the job. */
export const BOARD_IMAGES = 12;

/** The channel slug from an Are.na link (are.na/<user>/<slug> or are.na/channel/<slug>), or null. */
export function arenaSlug(link) {
  try {
    const url = new URL(String(link));
    if (!/(^|\.)are\.na$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) return parts[1];
    if (parts[0] === "block") return null;
    return parts.length >= 2 ? parts[1] : null;
  } catch {
    return null;
  }
}

/** Splits reference links into Are.na boards and other links. */
export function splitReferences(links) {
  const boards = [], other = [];
  for (const link of Array.isArray(links) ? links : []) {
    const slug = arenaSlug(link);
    if (slug && !boards.includes(slug)) boards.push(slug); else if (!slug) other.push(link);
  }
  return { boards: boards.slice(0, 3), other };
}

/** What to keep from a channel's blocks: images (and link previews) to download, and short text notes. */
export function boardItems(blocks, limit = BOARD_IMAGES) {
  const images = [], notes = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const src = block?.image?.medium?.src ?? block?.image?.large?.src ?? block?.image?.src;
    if (src && (block.type === "Image" || block.type === "Link" || block.type === "Embed") && images.length < limit) {
      images.push({ src, title: String(block.title ?? "").slice(0, 120) });
    } else if (block?.type === "Text" && notes.length < 6) {
      const text = String(block.content?.plain ?? block.content?.markdown ?? block.content ?? block.title ?? "").replace(/\s+/g, " ").trim();
      if (text) notes.push(text.slice(0, 300));
    }
  }
  return { images, notes };
}

/**
 * On the board Studio keeps, this reel's pins come first, then the newest; a standalone reel reads only its own pins
 * (other standalone reels' moods don't belong to it).
 */
export function preferred(blocks, { tag, only }) {
  const mine = (block) => block?.connection?.metadata?.studio_reel === tag;
  const list = (Array.isArray(blocks) ? blocks : []).filter((block) => !only || mine(block) || block?.type === "Text");
  return list.sort((a, b) => Number(mine(b)) - Number(mine(a)) || String(b?.connection?.connected_at ?? "").localeCompare(String(a?.connection?.connected_at ?? "")));
}

/**
 * Downloads the boards' images into `dir` as board1_01.jpg… and returns a description for the prompt. A board the
 * Mac can't read (CLI signed out, private channel of someone else) is reported, not fatal.
 */
export async function pullBoards(slugs, dir, { run, prefer }) {
  const lines = [], files = [];
  for (const [index, slug] of slugs.entries()) {
    let blocks;
    try {
      const { stdout } = await run("arena", ["channel", "contents", slug, "--per", "100", "--json", "--quiet"], { timeoutMs: 60_000, code: "arena_failed" });
      blocks = JSON.parse(stdout)?.data;
      if (prefer?.slug === slug) blocks = preferred(blocks, prefer);
    } catch {
      lines.push(`Are.na board "${slug}": couldn't be read on the Studio Mac (signed out, or not shared with this account).`);
      continue;
    }
    const { images, notes } = boardItems(blocks);
    const saved = [];
    for (const [n, image] of images.entries()) {
      try {
        const response = await fetch(image.src);
        if (!response.ok) continue;
        const name = `board${index + 1}_${String(n + 1).padStart(2, "0")}.jpg`;
        writeFileSync(join(dir, name), Buffer.from(await response.arrayBuffer()));
        saved.push(`${name}${image.title ? ` ("${image.title}")` : ""}`);
      } catch {
        // A pin that won't download is skipped.
      }
    }
    files.push(...saved.map((entry) => entry.split(" ")[0]));
    lines.push(`Are.na board "${slug}": ${saved.length ? `images ${saved.join(", ")}` : "no images"}${notes.length ? `; notes: ${notes.join(" | ")}` : ""}.`);
  }
  return { files, text: lines.join("\n") };
}
