import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  Guild,
  TextChannel,
  VoiceChannel,
} from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

export const getClient = (): Client => client;

export const loginDiscord = async (): Promise<{
  guild: Guild;
  playlistChannel: TextChannel;
  voiceChannel: VoiceChannel;
}> => {
  return new Promise((resolve, reject) => {
    client.once(Events.ClientReady, async (ready) => {
      logger.info({ tag: ready.user.tag }, "discord client ready");

      const guild = ready.guilds.cache.get(config.DISCORD_GUILD_ID);
      if (!guild) {
        logger.fatal({ guildId: config.DISCORD_GUILD_ID }, "guild not found");
        return reject(new Error("Guild not found"));
      }
      logger.info({ guild: guild.name }, "guild found");

      const playlistChannel = guild.channels.cache.get(config.PLAYLIST_CHANNEL_ID);
      if (!playlistChannel || playlistChannel.type !== ChannelType.GuildText) {
        logger.fatal(
          { channelId: config.PLAYLIST_CHANNEL_ID },
          "playlist channel must be a guild text channel",
        );
        return reject(new Error("Playlist channel not found or wrong type"));
      }
      logger.info({ channel: playlistChannel.name }, "playlist channel found");

      const voiceChannel = guild.channels.cache.get(config.VOICE_CHANNEL_ID);
      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        logger.fatal(
          { channelId: config.VOICE_CHANNEL_ID },
          "voice channel must be a guild voice channel",
        );
        return reject(new Error("Voice channel not found or wrong type"));
      }
      logger.info({ channel: voiceChannel.name }, "voice channel found");

      resolve({ guild, playlistChannel, voiceChannel });
    });

    client.once(Events.Error, (err) => {
      logger.fatal({ err }, "discord client error");
      reject(err);
    });

    client.login(config.DISCORD_TOKEN).catch(reject);
  });
};
