import { execFile } from "node:child_process";
import { logger } from "../logger.js";

const hasBin = (bin: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 15_000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim().split("\n")[0]);
    });
  });

export const checkPrerequisites = async (): Promise<void> => {
  logger.info("checking system prerequisites…");

  try {
    const ytdlp = await hasBin("yt-dlp", ["--version"]);
    logger.info({ version: ytdlp }, "yt-dlp found");
  } catch {
    logger.fatal("yt-dlp is not installed or not on PATH. Install it first: https://github.com/yt-dlp/yt-dlp");
    process.exit(1);
  }

  try {
    const ffmpeg = await hasBin("ffmpeg", ["-version"]);
    logger.info({ version: ffmpeg }, "ffmpeg found");
  } catch {
    logger.fatal("ffmpeg is not installed or not on PATH. Install it first: https://ffmpeg.org/download.html");
    process.exit(1);
  }

  logger.info("all prerequisites satisfied");
};
