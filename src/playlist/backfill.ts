import type { Collection, Message, TextChannel } from "discord.js";
import { logger } from "../logger.js";
import { extractTracksFromMessage } from "./ingest.js";
import type { Track } from "./types.js";

const PAGE_SIZE = 100;
// Discord's snowflake epoch — `after: '0'` means "everything ever".
const SNOWFLAKE_BEGINNING = "0";

const compareSnowflake = (a: string, b: string): number => {
  const ba = BigInt(a);
  const bb = BigInt(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
};

/**
 * Walk the channel's history forward — oldest to newest — and return the
 * resolved Track[] in chronological order plus the ID of the most recent
 * message we saw.
 *
 * - Full scan: pass no `afterId` (we paginate from the beginning of time).
 * - Incremental: pass `afterId` to fetch only messages strictly newer.
 *
 * Discord paginates 100 messages per request; we use `after:` cursors
 * because the result is bounded by "newer than" semantics, which makes
 * forward pagination trivial.
 *
 * `onPage` is called after each parallel metadata batch with the running
 * tracks accumulator, so callers can stream results into the queue as
 * they're discovered (used by the boot backfill).
 */
export const scanChannel = async (
  channel: TextChannel,
  afterId?: string,
  onPage?: (tracksSoFar: Track[]) => void,
): Promise<{ tracks: Track[]; lastMessageId: string | null }> => {
  const tracks: Track[] = [];
  let cursor: string = afterId ?? SNOWFLAKE_BEGINNING;
  let lastSeen: string | null = afterId ?? null;
  let pageNum = 0;

  logger.info(
    { channel: channel.name, afterId: afterId ?? "(beginning)" },
    "channel scan starting",
  );

  while (true) {
    pageNum++;
    let batch: Collection<string, Message>;
    try {
      batch = await channel.messages.fetch({ limit: PAGE_SIZE, after: cursor });
    } catch (err) {
      logger.error(
        { err: (err as Error).message, page: pageNum },
        "channel scan failed mid-pagination",
      );
      break;
    }

    logger.info(
      { page: pageNum, fetched: batch.size },
      "channel scan page fetched",
    );
    if (batch.size === 0) break;

    // Sort oldest-first so the queue order matches the order links were posted.
    const sorted = [...batch.values()]
      .sort((a, b) => compareSnowflake(a.id, b.id))
      .filter((m) => !m.author.bot);

    // Resolve metadata in parallel within a page. Concurrency is bounded so
    // we don't hammer YouTube — a single yt-dlp metadata call is ~3s, four
    // in parallel cuts a typical page from minutes to ~25s.
    const CONCURRENCY = 4;
    const pageTracks: Track[] = [];
    for (let i = 0; i < sorted.length; i += CONCURRENCY) {
      const slice = sorted.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        slice.map((m) => extractTracksFromMessage(m)),
      );
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value.length > 0) {
          pageTracks.push(...r.value);
        }
      }
    }

    if (sorted.length > 0) {
      lastSeen = sorted[sorted.length - 1].id;
      cursor = sorted[sorted.length - 1].id;
    }
    tracks.push(...pageTracks);
    logger.info(
      { page: pageNum, pageTracks: pageTracks.length, totalSoFar: tracks.length },
      "backfill page resolved",
    );
    // onPage receives the page's delta so callers can stream-append.
    if (onPage && pageTracks.length > 0) onPage(pageTracks);

    if (batch.size < PAGE_SIZE) break;
  }

  logger.info(
    { tracks: tracks.length, lastMessageId: lastSeen, pages: pageNum },
    afterId ? "incremental backfill complete" : "full channel scan complete",
  );
  return { tracks, lastMessageId: lastSeen };
};
