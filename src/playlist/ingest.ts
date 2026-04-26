import { Events, type Message } from "discord.js";
import { config } from "../config.js";
import { getClient } from "../discord/client.js";
import { logger } from "../logger.js";
import { detectUrls } from "../youtube/urlMatcher.js";
import { expandPlaylist, getTrackMeta, type YtTrackMeta } from "../youtube/ytdlp.js";
import { getStore } from "./store.js";
import type { Track } from "./types.js";

import { hasNegativeReaction, type ReactionLike } from "./reactions.js";
export { hasNegativeReaction } from "./reactions.js";

interface MessageForIngest {
  id: string;
  content: string;
  createdAt: Date;
  author: { username: string; globalName?: string | null };
  reactions: { cache: { values(): Iterable<ReactionLike> } };
}

const metaToTrack = (meta: YtTrackMeta, msg: MessageForIngest): Track => ({
  youtubeId: meta.youtubeId,
  url: meta.url,
  title: meta.title,
  uploader: meta.uploader,
  durationSec: meta.durationSec,
  // Use the message creation time so /reset-playlist after a reboot
  // reproduces the same `addedAt` instead of "whenever the bot scanned it".
  addedAt: msg.createdAt.toISOString(),
  addedByMessageId: msg.id,
  addedBy: msg.author.globalName ?? msg.author.username,
});

const tryReact = async (message: Message, emoji: string): Promise<void> => {
  try {
    await message.react(emoji);
  } catch (err) {
    logger.debug({ err: (err as Error).message, emoji }, "failed to react");
  }
};

/**
 * Pure helper: pull every YouTube URL out of `message.content`, expand
 * playlists into individual tracks, and return the resolved Track[]. Empty
 * array if the message has no recognised URLs, has been vetoed with a ❌
 * reaction, or every resolution failed.
 *
 * Shared between live ingest (here) and backfill (playlist/backfill.ts).
 */
export const extractTracksFromMessage = async (
  message: MessageForIngest,
): Promise<Track[]> => {
  if (hasNegativeReaction(message.reactions.cache.values())) {
    logger.debug({ messageId: message.id }, "skipping ❌-vetoed message");
    return [];
  }

  const urls = detectUrls(message.content);
  if (urls.length === 0) return [];

  const tracks: Track[] = [];
  for (const u of urls) {
    try {
      if (u.type === "track") {
        const meta = await getTrackMeta(u.url);
        tracks.push(metaToTrack(meta, message));
      } else {
        const metas = await expandPlaylist(u.url);
        for (const meta of metas) {
          tracks.push(metaToTrack(meta, message));
        }
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, url: u.url },
        "failed to resolve URL",
      );
    }
  }
  return tracks;
};

const processMessage = async (message: Message): Promise<void> => {
  const tracks = await extractTracksFromMessage(message);

  if (tracks.length > 0) {
    getStore().appendTracks(tracks);
    logger.info(
      { added: tracks.length, messageId: message.id, author: message.author.username },
      "tracks ingested",
    );
    await tryReact(message, "✅");
  } else if (detectUrls(message.content).length > 0) {
    // URLs were posted but none resolved — let the user know.
    await tryReact(message, "❌");
  }
  // Mark every processed message so the incremental backfill skips it next
  // time, regardless of whether we found tracks.
  getStore().setLastSeenMessageId(message.id);
};

/**
 * Subscribe to messageCreate events on the configured playlist channel and
 * append any YouTube URLs found to the queue. Bot messages and other
 * channels are ignored. Cf. CLAUDE.md D5.
 */
export const installIngestListener = (): void => {
  const client = getClient();
  client.on(Events.MessageCreate, (message) => {
    if (message.channelId !== config.PLAYLIST_CHANNEL_ID) return;
    if (message.author.bot) return;
    // Don't await — long playlist expansions must not block the gateway.
    void processMessage(message);
  });
  logger.info(
    { channelId: config.PLAYLIST_CHANNEL_ID },
    "ingest listener installed",
  );
};
