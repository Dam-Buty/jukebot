import { config } from "./config.js";
import { logger } from "./logger.js";
import { checkPrerequisites } from "./util/prerequisites.js";
import { loginDiscord, getClient } from "./discord/client.js";
import { getStore } from "./playlist/store.js";
import { connectVoice, disconnectVoice } from "./audio/voice.js";
import { stopPlayback } from "./audio/player.js";
import { installPlaybackOrchestration, playCurrent } from "./audio/playback.js";
import { installIngestListener } from "./playlist/ingest.js";
import { scanChannel } from "./playlist/backfill.js";
import {
  hasListeners,
  installVoicePresence,
  teardownVoicePresence,
} from "./discord/voicePresence.js";
import {
  installCommandHandlers,
  registerSlashCommands,
} from "./discord/commands.js";

const main = async (): Promise<void> => {
  logger.info("jukebot starting…");
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

  installIngestListener();

  await registerSlashCommands();
  installCommandHandlers(channels.playlistChannel);

  await connectVoice(channels.voiceChannel);
  installPlaybackOrchestration(hasListeners);
  installVoicePresence(channels.voiceChannel);

  // Backfill runs in the background so the bot is fully online (commands,
  // voice, live ingest) while it catches up on history. Tracks stream into
  // the queue per page so /list shows progress and playback can start as
  // soon as the first page lands.
  void (async () => {
    try {
      const cursor = store.getState().lastSeenMessageId;
      const { lastMessageId } = await scanChannel(
        channels.playlistChannel,
        cursor,
        (pageTracks) => {
          store.appendTracks(pageTracks);
        },
      );
      if (lastMessageId) store.setLastSeenMessageId(lastMessageId);
      logger.info("backfill complete");
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        "backfill scan failed; live ingest will pick up new posts regardless",
      );
    }
  })();

  // Note: we deliberately don't kick playCurrent() here. installVoicePresence
  // does it on its own based on whether anyone is in the voice channel at
  // boot time.

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down…");
    try {
      teardownVoicePresence();
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
