import { spawn } from "node:child_process";
import { logger } from "../logger.js";

const YT_DLP_TIMEOUT_MS = 30_000;
const RATE_LIMIT_RETRY_MS = 5_000;

// Same client cascade as the playback path (audio/ffmpeg.ts) — keeps the
// metadata calls out of the web_safari + Visitor Data PO token mess.
const EXTRACTOR_ARGS = ["--extractor-args", "youtube:player_client=android,web"];

export interface YtTrackMeta {
  youtubeId: string;
  url: string;
  title: string;
  uploader: string;
  durationSec: number;
}

const isRateLimited = (msg: string): boolean =>
  /\b429\b|Too Many Requests/i.test(msg);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const spawnYtDlpOnce = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", [...EXTRACTOR_ARGS, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: YT_DLP_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`yt-dlp spawn failed: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout.trim());
    });
  });

const spawnYtDlp = async (args: string[]): Promise<string> => {
  try {
    return await spawnYtDlpOnce(args);
  } catch (err) {
    if (isRateLimited((err as Error).message)) {
      logger.warn(
        { backoffMs: RATE_LIMIT_RETRY_MS },
        "yt-dlp metadata rate limited, retrying once",
      );
      await sleep(RATE_LIMIT_RETRY_MS);
      return spawnYtDlpOnce(args);
    }
    throw err;
  }
};

const parseTrackJson = (raw: string, url: string): YtTrackMeta => {
  const data = JSON.parse(raw);
  const id = data.id ?? data.webpage_url_basename;
  if (!id) {
    throw new Error(`yt-dlp output missing id for ${url}`);
  }
  return {
    youtubeId: id,
    url: data.webpage_url ?? data.original_url ?? url,
    title: data.title ?? "Unknown",
    uploader: data.uploader ?? data.channel ?? "Unknown",
    durationSec: data.duration ?? 0,
  };
};

export const getTrackMeta = async (url: string): Promise<YtTrackMeta> => {
  const stdout = await spawnYtDlp([
    "--no-playlist",
    "--dump-json",
    "--skip-download",
    url,
  ]);
  return parseTrackJson(stdout, url);
};

export const expandPlaylist = async (url: string): Promise<YtTrackMeta[]> => {
  const stdout = await spawnYtDlp([
    "--flat-playlist",
    "--dump-json",
    "--skip-download",
    url,
  ]);

  const lines = stdout.split("\n").filter((l) => l.trim());
  const entries: { id: string; url: string }[] = [];

  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      const id = data.id;
      if (id) {
        entries.push({
          id,
          url: data.url ?? `https://www.youtube.com/watch?v=${id}`,
        });
      }
    } catch {
      logger.warn({ line }, "yt-dlp flat playlist line parse failed, skipping");
    }
  }

  logger.info({ count: entries.length, playlistUrl: url }, "expanding playlist entries for durations");

  const CONCURRENCY = 4;
  const results: YtTrackMeta[] = [];

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((e) => getTrackMeta(e.url)),
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        logger.warn({ error: (r.reason as Error)?.message }, "skipping unavailable playlist entry");
      }
    }
  }

  return results;
};
