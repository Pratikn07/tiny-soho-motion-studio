// The Studio Mac keeps the Are.na moodboards itself: one private channel per series ("Tiny Soho · Halloween",
// "Tiny Soho · Standalone"), found on the creator's account or created when missing. For each reel it finds public
// channels that fit the brief (Are.na's public channel search, plus channels the board's pins already sit in), puts
// candidate images on numbered contact sheets, lets Claude pick 8-12, and connects those pins to the board tagged with
// the reel. Connecting is Are.na's own way to reuse a pin; nothing is downloaded and re-uploaded. The creator only
// prunes: a pin deleted from the board is never used again.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const BOARD_PREFIX = "Tiny Soho · ";
/** Pins Claude picks per reel, and the candidates it looks at (12 to a contact sheet). */
export const PICKS = { min: 8, max: 12 };
export const CANDIDATES = 48;
const PER_SHEET = 12;
const SEARCH = "https://api.are.na/v2/search/channels";
const FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";

function stepError(code, message) {
  return Object.assign(new Error(message), { code });
}

const clean = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The board for a reel: the series' board, or the shared one for standalone reels. */
export function boardFor(series) {
  const name = clean(series, 60);
  const standalone = !name || /^standalone$/i.test(name);
  return { title: `${BOARD_PREFIX}${standalone ? "Standalone" : name}`, standalone, series: standalone ? "" : name };
}

/** The tag on every pin Studio connects, so the board shows which reel added it. */
export const reelTag = (reelId) => String(reelId ?? "").replace(/-/g, "").slice(0, 8) || "reel";

async function arenaJson(run, args, timeoutMs = 60_000) {
  const { stdout } = await run("arena", [...args, "--json", "--quiet"], { timeoutMs, code: "arena_failed" });
  return JSON.parse(stdout);
}

/** Finds the board on the creator's account by title, or creates it as a private channel. */
export async function findOrCreateBoard(board, { run }) {
  const me = (await arenaJson(run, ["whoami"]))?.slug;
  if (!me) throw stepError("arena_signed_out", "The Are.na CLI on the Studio Mac isn't signed in (run: arena login).");
  const mine = await arenaJson(run, ["user", "contents", me, "--type", "Channel", "--per", "100"]);
  const found = (mine?.data ?? []).find((channel) => clean(channel.title, 120).toLowerCase() === board.title.toLowerCase());
  if (found) return { slug: found.slug, url: `https://www.are.na/${me}/${found.slug}`, me, created: false };
  const description = board.standalone
    ? "Moodboard kept by Tiny Soho Studio for standalone reels. Studio adds pins for each reel; delete any pin you don't want used."
    : `Moodboard kept by Tiny Soho Studio for the ${board.series} series. Studio adds pins for each reel; delete any pin you don't want used.`;
  const made = await arenaJson(run, ["channel", "create", board.title, "--visibility", "private", "--description", description]);
  const slug = made?.slug ?? made?.data?.slug;
  if (!slug) throw stepError("arena_failed", "Are.na didn't return the new channel.");
  return { slug, url: `https://www.are.na/${me}/${slug}`, me, created: true };
}

/** Image pins in a channel listing, with what we need to show and connect them. */
export function imagePins(blocks) {
  return (Array.isArray(blocks) ? blocks : []).flatMap((block) => {
    const src = block?.image?.small?.src ?? block?.image?.medium?.src ?? block?.image?.src;
    return block?.type === "Image" && src && Number.isInteger(block.id)
      ? [{ id: block.id, src, title: clean(block.title, 80), tag: block.connection?.metadata?.studio_reel ?? null, at: block.connection?.connected_at ?? "" }]
      : [];
  });
}

/** Search terms from Claude's answer: 1-2 words each, the way Are.na channels are named (longer ones rarely match). */
export function parseQueries(text) {
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  let data = [];
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { /* falls through */ }
  return [...new Set((Array.isArray(data) ? data : []).map((item) => clean(item, 40).toLowerCase()).filter((item) => item && item.split(" ").length <= 2))].slice(0, 5);
}

/** Search terms when Claude can't help: the treatment's first words and the series. */
export function fallbackQueries(input) {
  const treatment = clean(input.brief?.treatment, 200).toLowerCase().split(/[,:;.]/)[0].split(" ").filter((word) => word.length > 2).slice(0, 2).join(" ");
  const series = clean(input.series ?? input.brief?.series, 40).toLowerCase();
  return [...new Set([treatment, /^standalone$/.test(series) ? "" : series, "paper collage", "risograph"].filter(Boolean))];
}

/** Public channels from Are.na's channel search worth looking through (enough pins, not our own). */
export function goodChannels(found, me) {
  return (Array.isArray(found) ? found : [])
    .filter((channel) => ["public", "closed"].includes(channel?.status) && Number(channel?.length) >= 10 && channel?.slug && channel?.user?.slug !== me)
    .map((channel) => channel.slug);
}

/** Claude's picks: candidate numbers that exist, without repeats. */
export function parsePicks(text, count) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  let data = null;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { /* falls through */ }
  const picks = [...new Set((Array.isArray(data?.picks) ? data.picks : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= count))];
  if (!picks.length) throw stepError("claude_bad_output", "Claude didn't pick any pins for the board.");
  return { picks: picks.slice(0, PICKS.max), summary: clean(data?.summary, 300) };
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Downloads candidates as numbered tiles and joins them into contact sheets of 12 (4 across, 3 down). */
export async function contactSheets(candidates, dir, { run }) {
  const kept = [];
  for (const pin of candidates) {
    try {
      const response = await fetch(pin.src);
      if (!response.ok) continue;
      const raw = join(dir, `raw_${pin.id}`);
      writeFileSync(raw, Buffer.from(await response.arrayBuffer()));
      const n = kept.length + 1;
      await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-frames:v", "1", "-vf",
        `scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:white,drawtext=fontfile='${FONT}':text='${n}':x=8:y=8:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=6,format=yuvj420p`,
        join(dir, `tile_${String(n).padStart(3, "0")}.jpg`)], { timeoutMs: 30_000, code: "arena_failed" });
      kept.push(pin);
    } catch {
      // A pin that won't download or decode is left out.
    }
  }
  if (!kept.length) return { kept, sheets: [] };
  // Blank tiles fill the last sheet (ffmpeg's tiler drops a part-filled one); every tile is one frame of the sheets.
  for (let n = kept.length + 1; n <= Math.ceil(kept.length / PER_SHEET) * PER_SHEET; n += 1) {
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=white:s=320x320", "-frames:v", "1", "-pix_fmt", "yuvj420p",
      join(dir, `tile_${String(n).padStart(3, "0")}.jpg`)], { timeoutMs: 30_000, code: "arena_failed" });
  }
  await run("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "tile_%03d.jpg"), "-vf", "tile=4x3:padding=6:color=white", "-fps_mode", "passthrough",
    "-q:v", "3", join(dir, "sheet_%02d.jpg")], { timeoutMs: 60_000, code: "arena_failed" });
  return { kept, sheets: Array.from({ length: Math.ceil(kept.length / PER_SHEET) }, (_, i) => `sheet_${String(i + 1).padStart(2, "0")}.jpg`) };
}

async function searchChannels(query) {
  try {
    const response = await fetch(`${SEARCH}?q=${encodeURIComponent(query)}&per=10`, { headers: { accept: "application/json" } });
    if (!response.ok) return [];
    return (await response.json())?.channels ?? [];
  } catch {
    return []; // Search answering with a web page or not at all just means fewer sources.
  }
}

/**
 * Keeps the reel's board: finds or creates it, and adds this reel's pins once (again when the creator turned down
 * every look). Returns what the storyboard should read and a summary for Studio. Never throws for Are.na trouble;
 * the storyboard carries on without the board and says why.
 */
export async function keepBoard(job, tools, deps, dir) {
  const input = job.input ?? {};
  const board = boardFor(input.series ?? input.brief?.series);
  const tag = reelTag(job.reelId);
  try {
    const kept = await findOrCreateBoard(board, deps);
    const contents = await arenaJson(deps.run, ["channel", "contents", kept.slug, "--per", "100"]);
    const pins = imagePins(contents?.data);
    const mine = pins.filter((pin) => pin.tag === tag);
    const moreLooks = input.phase === "look" && !input.current && !input.own && (input.avoid ?? []).length > 0;
    let added = 0, summary = "", sources = [];
    if (!mine.length || (moreLooks && mine.length < PICKS.max * 2)) {
      await tools.progress(`Finding pins for your Are.na board "${board.title}"`);
      const asked = await deps.askClaude([
        "Suggest 5 Are.na channel searches to find mood images for this reel's look. Are.na matches channel names, so each search is",
        "1-2 common words a designer would name a channel, e.g. \"risograph\", \"paper collage\", \"halloween\", \"night sky\", \"felt\".",
        "Think medium, texture, colour and season, not the topic's facts. No combined phrases like \"riso orange blue\".",
        `Series: ${board.series || "standalone"}. Emotion: ${clean(input.brief?.emotion, 120)}. Treatment: ${clean(input.brief?.treatment ?? input.own, 300)}.`,
        `Signature moment: ${clean(input.brief?.signatureMoment, 200)}. Title: ${clean(input.brief?.title ?? input.idea?.title, 120)}.`,
        `Looks the creator turned down: ${(input.avoid ?? []).join("; ").slice(0, 400) || "none"}.`,
        "Answer with only a JSON array of 5 strings.",
      ].join("\n"), { timeoutMs: 90_000, effort: "low" }).catch(() => "");
      const terms = [...new Set([...parseQueries(asked), ...fallbackQueries(input)])];
      const found = [];
      for (const term of terms) {
        if (new Set(found).size >= 6) break;
        found.push(...goodChannels(await searchChannels(term), kept.me).slice(0, 2));
      }
      // Channels the board's own pins also sit in: the series' taste, one step out.
      for (const pin of shuffle(pins).slice(0, 2)) {
        const linked = await arenaJson(deps.run, ["block", "connections", String(pin.id)]).catch(() => null);
        found.push(...(linked?.data ?? []).filter((channel) => channel?.slug && channel.slug !== kept.slug && channel?.owner?.slug !== kept.me).map((channel) => channel.slug).slice(0, 1));
      }
      sources = [...new Set(found)].slice(0, 8);
      const have = new Set(pins.map((pin) => pin.id));
      const candidates = [];
      const each = Math.min(16, Math.ceil(CANDIDATES / Math.max(1, sources.length)));
      for (const slug of sources) {
        const listing = await arenaJson(deps.run, ["channel", "contents", slug, "--per", "60"]).catch(() => null);
        const fresh = shuffle(imagePins(listing?.data).filter((pin) => !have.has(pin.id))).slice(0, each);
        for (const pin of fresh) { have.add(pin.id); candidates.push(pin); }
      }
      const { kept: shown, sheets } = await contactSheets(shuffle(candidates).slice(0, CANDIDATES), dir, deps);
      if (shown.length >= PICKS.min) {
        await tools.progress(`Claude is choosing pins for "${board.title}"`);
        const answer = await deps.askClaude([
          "You keep the Are.na moodboard for @tinysoho, a calm, realistic parenting account (US moms of toddlers). Its reels are",
          "story reels in a collage card style: textured paper, cut-out stickers with white edges, calm editorial motion.",
          `Board: ${board.title}. Series: ${board.series || "standalone"}. Emotion: ${clean(input.brief?.emotion, 120)}.`,
          `This reel's treatment: ${clean(input.brief?.treatment ?? input.own, 300) || "not decided yet"}. Title: ${clean(input.brief?.title ?? input.idea?.title, 120)}.`,
          `Look at every contact sheet with Read: ${sheets.join(", ")}. Each tile is numbered 1-${shown.length} in its top-left corner.`,
          `Pick ${PICKS.min}-${PICKS.max} pins that give this reel its mood: texture, medium, colour, composition, type. Varied, not near-duplicates.`,
          "Never pick: photos of real children or identifiable people, logos or brands, ads, screenshots of text or apps, anything scary,",
          "gory, sexual or political, or anything that would look like copying one artist's piece.",
          'Answer with only JSON: {"picks": [numbers], "summary": "one line: the mood these pins set"}.',
        ].join("\n"), { cwd: dir, tools: ["Read"], maxTurns: sheets.length + 4, timeoutMs: 4 * 60_000, effort: "low" });
        const chosen = parsePicks(answer, shown.length);
        summary = chosen.summary;
        for (const n of chosen.picks) {
          const pin = shown[n - 1];
          const done = await deps.run("arena", ["connect", String(pin.id), kept.slug, "--type", "Block", "--metadata", `studio_reel=${tag}`, "--json", "--quiet"],
            { timeoutMs: 30_000, code: "arena_failed" }).then(() => true, () => false);
          if (done) added += 1;
        }
      } else {
        summary = "Not enough public pins found this time; the board is used as it is.";
      }
    }
    return { slug: kept.slug, tag, standalone: board.standalone,
      summary: { title: board.title, url: kept.url, created: kept.created, added, total: pins.length + added, sources: sources.slice(0, 8), note: summary } };
  } catch (error) {
    return { slug: null, tag, standalone: board.standalone, summary: { title: board.title, error: clean(error?.message, 200) || "Are.na didn't answer." } };
  }
}
