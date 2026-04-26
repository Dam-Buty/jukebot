import { config } from "./config.js";
import { logger } from "./logger.js";
import { checkPrerequisites } from "./util/prerequisites.js";
import { loginDiscord, getClient } from "./discord/client.js";
import { getStore } from "./playlist/store.js";
import { currentPosition } from "./playlist/timeline.js";
import { connectVoice, disconnectVoice } from "./audio/voice.js";
import { onPlayerEvent, playTrack, stopPlayback } from "./audio/player.js";
import { installIngestListener } from "./playlist/ingest.js";

const main = async (): Promise<void> => {
  logger.info("jukebot starting…");
  // Touch config so any invalid env aborts early with a helpful message.
  void config;

  await checkPrerequisites();

  const channels = await loginDiscord();
  logger.info(
    {
      guild: channels.guild.name,
      playlist: channels.playlistChannel.name,
      voice: channels.voiceChannel.name,
    },
    "jukebot online",
  );

  const store = getStore();

  // Install the message listener early so links posted during voice connect
  // still get queued.
  installIngestListener();

  await connectVoice(channels.voiceChannel);

  const playCurrent = async (): Promise<void> => {
    const pos = currentPosition(store.getState(), new Date());
    if (!pos) {
      logger.info("queue empty, radio silent");
      return;
    }
    try {
      await playTrack(pos.track, pos.offsetSec);
    } catch (err) {
      logger.error(
        { err: (err as Error).message, track: pos.track.title },
        "playTrack failed, skipping",
      );
      store.markEndOfTrack();
      // Re-enter; the next track may still work.
      void playCurrent();
    }
  };

  onPlayerEvent("track-finished", (err) => {
    if (err) {
      logger.warn({ err: err.message }, "track ended on error, advancing");
    }
    store.markEndOfTrack();
    void playCurrent();
  });

  // When the queue transitions empty → non-empty (first link posted), kick
  // playback. Subsequent appends are picked up on the next loop wrap (D12).
  let lastTrackCount = store.getState().tracks.length;
  store.on("tracks-changed", () => {
    const count = store.getState().tracks.length;
    if (lastTrackCount === 0 && count > 0) {
      logger.info("queue went from empty to non-empty, starting playback");
      void playCurrent();
    }
    lastTrackCount = count;
  });

  // If a previous session left tracks in state.json, resume right away.
  if (store.getState().tracks.length > 0) {
    void playCurrent();
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down…");
    try {
      stopPlayback();
      disconnectVoice();
      await getClient().destroy();
    } catch (err) {
      logger.warn({ err }, "error during shutdown, exiting anyway");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((err) => {
  console.error("jukebot fatal startup error:", err);
  process.exit(1);
});
