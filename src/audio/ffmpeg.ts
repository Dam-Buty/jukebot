import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import { logger } from "../logger.js";

const execFileP = promisify(execFile);

const YT_DLP_TIMEOUT_MS = 30_000;
const RATE_LIMIT_RETRY_MS = 5_000;

/**
 * Shared yt-dlp args that sidestep two recurring YouTube headaches:
 *
 * - `youtube:player_client=android,web` falls through to the Android client
 *   first, which doesn't require a Visitor Data PO token. The web client
 *   started returning HTTP 429 + "Missing required Visitor Data" in late
 *   2024; android continues to work.
 * - The format selector `bestaudio* / best` (no space in real arg) accepts
 *   both audio-only and audio+video formats so we don't fail when one
 *   client only exposes combined streams. ffmpeg's `-vn` later strips
 *   video on the decode side anyway.
 */
const YT_DLP_BASE_ARGS = [
  "--extractor-args",
  "youtube:player_client=android,web",
  "-f",
  "bestaudio*/best",
  "--no-playlist",
];

const isRateLimited = (err: unknown): boolean => {
  const msg = (err as Error)?.message ?? "";
  return /\b429\b|Too Many Requests/i.test(msg);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve a YouTube watch URL to its direct media URL via `yt-dlp -g`.
 * Retries once on 429 after a brief backoff; returns the first URL when
 * multiple are emitted (we treat the cascade as ranked by yt-dlp).
 */
export const getDirectAudioUrl = async (
  youtubeUrl: string,
  attempt = 0,
): Promise<string> => {
  try {
    const { stdout } = await execFileP(
      "yt-dlp",
      [...YT_DLP_BASE_ARGS, "-g", youtubeUrl],
      { timeout: YT_DLP_TIMEOUT_MS },
    );
    const url = stdout.trim().split("\n")[0];
    if (!url) throw new Error(`yt-dlp returned no direct URL for ${youtubeUrl}`);
    return url;
  } catch (err) {
    if (attempt === 0 && isRateLimited(err)) {
      logger.warn(
        { url: youtubeUrl, backoffMs: RATE_LIMIT_RETRY_MS },
        "yt-dlp rate limited, retrying once",
      );
      await sleep(RATE_LIMIT_RETRY_MS);
      return getDirectAudioUrl(youtubeUrl, attempt + 1);
    }
    throw err;
  }
};

export interface OpusStream {
  stream: Readable;
  kill: () => void;
}

/**
 * Spawn ffmpeg to transcode the direct media URL into Ogg-Opus, optionally
 * seeking to `offsetSec` before decoding (fast input-side seek; may be a few
 * ms imprecise — fine for radio playback).
 *
 * Caller is responsible for `kill()` when the stream is no longer needed
 * (e.g., on intentional stop or skip), otherwise the subprocess exits
 * naturally on EOF.
 */
export const createOpusStream = (
  directUrl: string,
  offsetSec: number,
): OpusStream => {
  const args: string[] = ["-loglevel", "warning"];
  if (offsetSec > 0) {
    // Input-side seek: fast, slightly inaccurate, good enough.
    args.push("-ss", offsetSec.toFixed(2));
  }
  args.push(
    "-i",
    directUrl,
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "ogg",
    "pipe:1",
  );

  const child = spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) logger.debug({ ffmpeg: msg }, "ffmpeg stderr");
  });

  child.on("error", (err) => {
    logger.error({ err: err.message }, "ffmpeg spawn error");
  });

  return {
    stream: child.stdout,
    kill: () => {
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* best-effort */
        }
      }
    },
  };
};
