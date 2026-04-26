import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";
import { logger } from "../logger.js";

let connection: VoiceConnection | null = null;

const isAlive = (c: VoiceConnection): boolean =>
  c.state.status !== VoiceConnectionStatus.Destroyed &&
  c.state.status !== VoiceConnectionStatus.Disconnected;

/**
 * Join the configured voice channel and wait until the connection is Ready.
 * Idempotent: a second call returns the existing connection if still alive.
 */
export const connectVoice = async (channel: VoiceChannel): Promise<VoiceConnection> => {
  if (connection && isAlive(connection)) {
    return connection;
  }

  logger.info({ channel: channel.name }, "joining voice channel");
  // Voice gateway debug events are noisy and contain ephemeral session tokens,
  // so only opt in when the operator has explicitly raised the log level.
  const wantsVoiceDebug = ["debug", "trace"].includes(process.env.LOG_LEVEL ?? "");
  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
    debug: wantsVoiceDebug,
  });

  connection.on("stateChange", (oldS, newS) => {
    logger.debug({ from: oldS.status, to: newS.status }, "voice state change");
  });
  if (wantsVoiceDebug) {
    connection.on("debug", (msg) => logger.debug({ voice: msg }, "voice debug"));
  }
  connection.on("error", (err) => logger.error({ err: err.message }, "voice error"));

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    logger.info("voice connection ready");
  } catch (err) {
    connection.destroy();
    connection = null;
    throw new Error(
      `voice connection failed to become ready: ${(err as Error).message}`,
    );
  }

  // Recovery handler for *post-init* disconnects only — registered after the
  // first Ready so it can't race with the initial handshake (transient
  // Disconnected → destroy() would abort the entersState(Ready) above).
  // Phase 7 will replace this with proper presence-driven reconnect.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    logger.warn("voice connection disconnected");
    if (!connection) return;
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      logger.info("voice connection recovering");
    } catch {
      logger.error("voice connection unrecoverable, destroying");
      connection?.destroy();
      connection = null;
    }
  });

  return connection;
};

export const disconnectVoice = (): void => {
  if (connection) {
    try {
      connection.destroy();
    } catch {
      /* best-effort */
    }
    connection = null;
  }
};

export const getConnection = (): VoiceConnection | null => connection;

export const isConnected = (): boolean =>
  connection !== null && isAlive(connection);
