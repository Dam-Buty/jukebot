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
import {
  clearChannelStatus,
  installChannelStatus,
} from "./discord/channelStatus.js";

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
  installChannelStatus(channels.voiceChannel);
  installPlaybackOrchestration(hasListeners);
  installVoicePresence(channels.voiceChannel);

  // Backfill runs in the background so the bot is fully online (commands,
  // voice, live ingest) while it catches up on history. Both the tracks
  // *and* the lastSeenMessageId cursor are persisted per page — if the
  // bot is killed mid-scan, the next boot resumes from the last fully
  // processed page instead of restarting from the beginning of time.
  // state.json is the cache here; nothing else needed.
  void (async () => {
    try {
      const resumeFrom = store.getState().lastSeenMessageId;
      logger.info(
        resumeFrom
          ? { resumingFrom: resumeFrom }
          : { mode: "full scan (no cached cursor)" },
        "backfill starting",
      );
      await scanChannel(
        channels.playlistChannel,
        resumeFrom,
        (pageTracks, pageLastMessageId) => {
          if (pageTracks.length > 0) store.appendTracks(pageTracks);
          store.setLastSeenMessageId(pageLastMessageId);
        },
      );
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
      await clearChannelStatus();
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
