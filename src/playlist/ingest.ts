import { Events, type Message } from "discord.js";
import { config } from "../config.js";
import { getClient } from "../discord/client.js";
import { logger } from "../logger.js";
import { detectUrls } from "../youtube/urlMatcher.js";
import { expandPlaylist, getTrackMeta, type YtTrackMeta } from "../youtube/ytdlp.js";
import { getStore } from "./store.js";
import type { Track } from "./types.js";

const metaToTrack = (meta: YtTrackMeta, messageId: string): Track => ({
  youtubeId: meta.youtubeId,
  url: meta.url,
  title: meta.title,
  uploader: meta.uploader,
  durationSec: meta.durationSec,
  addedAt: new Date().toISOString(),
  addedByMessageId: messageId,
});

const tryReact = async (message: Message, emoji: string): Promise<void> => {
  try {
    await message.react(emoji);
  } catch (err) {
    logger.debug({ err: (err as Error).message, emoji }, "failed to react");
  }
};

const processMessage = async (message: Message): Promise<void> => {
  const urls = detectUrls(message.content);
  if (urls.length === 0) {
    // Still mark as seen so backfill increment doesn't re-scan it.
    getStore().setLastSeenMessageId(message.id);
    return;
  }

  const tracks: Track[] = [];
  for (const u of urls) {
    try {
      if (u.type === "track") {
        const meta = await getTrackMeta(u.url);
        tracks.push(metaToTrack(meta, message.id));
      } else {
        const metas = await expandPlaylist(u.url);
        for (const meta of metas) {
          tracks.push(metaToTrack(meta, message.id));
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, url: u.url }, "failed to ingest URL");
    }
  }

  if (tracks.length > 0) {
    getStore().appendTracks(tracks);
    logger.info(
      { added: tracks.length, messageId: message.id, author: message.author.username },
      "tracks ingested",
    );
    await tryReact(message, "✅");
  } else {
    await tryReact(message, "❌");
  }

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
