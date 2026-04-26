import {
  ChatInputCommandInteraction,
  Events,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  type TextChannel,
} from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getClient } from "./client.js";
import { renderQueue } from "../format/list.js";
import { getStore } from "../playlist/store.js";
import { scanChannel } from "../playlist/backfill.js";
import { restartFromCurrent } from "../audio/playback.js";

const COMMANDS = [
  new SlashCommandBuilder()
    .setName("list")
    .setDescription("Show the current track and what is up next.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("reset-playlist")
    .setDescription(
      "Wipe the queue and rebuild it from the playlist channel history.",
    )
    .toJSON(),
];

/**
 * Push the slash command definitions to Discord. Idempotent: registers as
 * guild commands so changes appear instantly without the global 1h cache.
 */
export const registerSlashCommands = async (): Promise<void> => {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(
      config.DISCORD_CLIENT_ID,
      config.DISCORD_GUILD_ID,
    ),
    { body: COMMANDS },
  );
  logger.info({ count: COMMANDS.length }, "slash commands registered");
};

const handleList = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const body = renderQueue(getStore().getState(), new Date());
  await interaction.reply({ content: "```ansi\n" + body + "\n```" });
};

const handleResetPlaylist = async (
  interaction: ChatInputCommandInteraction,
  playlistChannel: TextChannel,
): Promise<void> => {
  await interaction.deferReply();
  logger.info(
    { initiator: interaction.user.username },
    "/reset-playlist invoked, scanning channel history",
  );

  const { tracks, lastMessageId } = await scanChannel(playlistChannel);
  const store = getStore();
  store.replaceAll(tracks);
  if (lastMessageId) store.setLastSeenMessageId(lastMessageId);

  // Hard cut: stop whatever's playing from the old queue and start fresh on
  // the new one. Less surprising for the user than waiting for the current
  // track to finish before the new playlist takes effect.
  await restartFromCurrent();

  await interaction.editReply(
    `✅ playlist rebuilt — ${tracks.length} track${tracks.length === 1 ? "" : "s"} loaded from history.`,
  );
};

/**
 * Wire up the InteractionCreate listener for our slash commands. Errors are
 * caught and surfaced to the user via an ephemeral reply where possible.
 */
export const installCommandHandlers = (playlistChannel: TextChannel): void => {
  const client = getClient();
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      switch (interaction.commandName) {
        case "list":
          await handleList(interaction);
          break;
        case "reset-playlist":
          await handleResetPlaylist(interaction, playlistChannel);
          break;
      }
    } catch (err) {
      logger.error(
        { err: (err as Error).message, command: interaction.commandName },
        "slash command handler errored",
      );
      const failure = `❌ command failed: ${(err as Error).message}`;
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(failure);
        } else {
          await interaction.reply({ content: failure, flags: MessageFlags.Ephemeral });
        }
      } catch {
        /* swallow secondary errors */
      }
    }
  });
};
