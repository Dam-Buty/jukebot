import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import { logger } from "../logger.js";

const execFileP = promisify(execFile);

const YT_DLP_TIMEOUT_MS = 30_000;

/**
 * Resolve a YouTube watch URL to its direct media URL via `yt-dlp -g`.
 * Returns the first URL when multiple are emitted (audio-only here).
 */
export const getDirectAudioUrl = async (youtubeUrl: string): Promise<string> => {
  const { stdout } = await execFileP(
    "yt-dlp",
    ["-f", "bestaudio", "--no-playlist", "-g", youtubeUrl],
    { timeout: YT_DLP_TIMEOUT_MS },
  );
  const url = stdout.trim().split("\n")[0];
  if (!url) throw new Error(`yt-dlp returned no direct URL for ${youtubeUrl}`);
  return url;
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
