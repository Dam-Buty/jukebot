import { config } from "./config.js";
import { logger } from "./logger.js";
import { checkPrerequisites } from "./util/prerequisites.js";
import { loginDiscord, getClient } from "./discord/client.js";

const main = async (): Promise<void> => {
  logger.info("jukebot starting…");

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

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down…");
    try {
      await getClient().destroy();
    } catch (err) {
      logger.warn({ err }, "error during client destroy, exiting anyway");
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
