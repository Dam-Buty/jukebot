import type { State } from "../playlist/types.js";
import { currentPosition } from "../playlist/timeline.js";

// Discord renders ANSI inside ```ansi code blocks. Only a small SGR subset is
// supported; we stick to the documented colors.
const RESET = "\u001b[0m";
const BOLD_CYAN = "\u001b[1;36m";
const BOLD_YELLOW = "\u001b[1;33m";
const GRAY = "\u001b[0;30m";
const GREEN = "\u001b[0;32m";
const WHITE = "\u001b[0;37m";

const BAR_FILLED = "▰";
const BAR_EMPTY = "▱";
const BAR_WIDTH = 24;

const FRAME_TOP = "╔═══════════════════════════════════════════════════╗";
const FRAME_BOT = "╚═══════════════════════════════════════════════════╝";
const FRAME_INNER_WIDTH = 51; // chars between the box-drawing edges
const MAX_DISCORD_BLOCK_BYTES = 1900; // ~100 char headroom under 2000 limit
const UP_NEXT_DEFAULT = 10;

const fmtTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + "…";

/**
 * Compact human-readable delta for /list. Tuned for the bot's expected
 * lifespan — anything older than a year just says "1y+ ago".
 */
export const relativeTime = (iso: string, now: Date): string => {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "?";
  if (ms < 0) return "in the future";
  const sec = Math.floor(ms / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
};

const center = (text: string, width: number): string => {
  if (text.length >= width) return text.slice(0, width);
  const pad = width - text.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return " ".repeat(left) + text + " ".repeat(right);
};

const bannerLine = (caption: string): string => {
  const inner = center(`♪  JUKEBOT  ─  ${caption}  ♪`, FRAME_INNER_WIDTH);
  return `║${inner}║`;
};

const progressBar = (offsetSec: number, totalSec: number): string => {
  const pct =
    totalSec > 0 ? Math.max(0, Math.min(1, offsetSec / totalSec)) : 0;
  const filled = Math.round(pct * BAR_WIDTH);
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(BAR_WIDTH - filled);
};

const idx = (n: number, width = 2): string =>
  n.toString().padStart(width, "0");

interface RenderOptions {
  upNext?: number;
}

/**
 * Build the body of a /list response. The caller is expected to wrap the
 * output in a ```ansi code block before sending to Discord.
 *
 * Output is bounded to MAX_DISCORD_BLOCK_BYTES; the up-next list is
 * progressively truncated until the whole thing fits.
 */
export const renderQueue = (
  state: State,
  now: Date,
  opts: RenderOptions = {},
): string => {
  const tracks = state.tracks;
  const queueSize = tracks.length;

  if (queueSize === 0) {
    return [
      `${BOLD_CYAN}${FRAME_TOP}${RESET}`,
      `${BOLD_CYAN}${bannerLine("RADIO SILENT")}${RESET}`,
      `${BOLD_CYAN}${FRAME_BOT}${RESET}`,
      "",
      `${GRAY}Queue is empty. Drop a YouTube link in the playlist channel${RESET}`,
      `${GRAY}and the radio will start automatically.${RESET}`,
    ].join("\n");
  }

  const pos = currentPosition(state, now);
  // pos can never be null when queueSize > 0, but typescript doesn't know.
  if (!pos) return "";

  const head = [
    `${BOLD_CYAN}${FRAME_TOP}${RESET}`,
    `${BOLD_CYAN}${bannerLine("NOW STREAMING")}${RESET}`,
    `${BOLD_CYAN}${FRAME_BOT}${RESET}`,
  ];

  const titleMax = 44;
  const fmtAddedBy = (t: typeof pos.track): string => {
    const author = t.addedBy ?? "?";
    const when = t.addedAt ? relativeTime(t.addedAt, now) : "";
    return when ? `added by ${author} · ${when}` : `added by ${author}`;
  };

  const nowPlaying = [
    "",
    `${BOLD_YELLOW}▶  ${idx(pos.index + 1)} / ${idx(queueSize)}${RESET}`,
    `   ${BOLD_YELLOW}${truncate(`${pos.track.uploader} — ${pos.track.title}`, titleMax)}${RESET}`,
    `   ${GREEN}${progressBar(pos.offsetSec, pos.track.durationSec)}${RESET}   ${WHITE}${fmtTime(pos.offsetSec)} / ${fmtTime(pos.track.durationSec)}${RESET}`,
    `   ${GRAY}${fmtAddedBy(pos.track)}${RESET}`,
  ];

  const upNextHeader = ["", `${WHITE}UP NEXT${RESET}`];

  const UP_TITLE_W = 28;
  const UP_AUTHOR_W = 12;
  const buildUpNext = (count: number): string[] => {
    const lines: string[] = [];
    for (let i = 1; i <= count; i++) {
      const ix = (pos.index + i) % queueSize;
      const t = tracks[ix];
      const lineTitle = truncate(`${t.uploader} — ${t.title}`, UP_TITLE_W);
      const time = fmtTime(t.durationSec);
      const author = truncate(t.addedBy ?? "?", UP_AUTHOR_W);
      lines.push(
        `   ${GRAY}${idx(ix + 1)}  ${lineTitle.padEnd(UP_TITLE_W)} ${time.padStart(5)}  ${author.padEnd(UP_AUTHOR_W)}${RESET}`,
      );
    }
    return lines;
  };

  const summary = (): string =>
    `${GRAY}${queueSize} track${queueSize === 1 ? "" : "s"} in loop, total ${fmtTime(
      tracks.reduce((s, t) => s + t.durationSec, 0),
    )}${RESET}`;

  // Try the requested up-next size; back off if the message would overflow
  // Discord's 2000-char block ceiling.
  const wanted = Math.min(opts.upNext ?? UP_NEXT_DEFAULT, queueSize - 1);
  for (let count = wanted; count >= 0; count--) {
    const lines = [
      ...head,
      ...nowPlaying,
      ...(count > 0 ? upNextHeader : []),
      ...buildUpNext(count),
      "",
      summary(),
    ];
    const out = lines.join("\n");
    if (out.length <= MAX_DISCORD_BLOCK_BYTES) return out;
  }

  // Worst case: only the now-playing block.
  return [...head, ...nowPlaying, "", summary()].join("\n");
};
