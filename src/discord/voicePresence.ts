import { Events, type VoiceChannel, type VoiceState } from "discord.js";
import { config } from "../config.js";
import { getClient } from "./client.js";
import { logger } from "../logger.js";
import { connectVoice, disconnectVoice, isConnected } from "../audio/voice.js";
import { stopPlayback } from "../audio/player.js";
import { playCurrent } from "../audio/playback.js";

let lastHumanCount = 0;
let idleTimer: NodeJS.Timeout | null = null;
let watchedChannel: VoiceChannel | null = null;

const countHumans = (channel: VoiceChannel): number =>
  channel.members.filter((m) => !m.user.bot).size;

export const hasListeners = (): boolean => lastHumanCount > 0;

const clearIdleTimer = (): void => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};

const onListenersArrived = async (channel: VoiceChannel): Promise<void> => {
  clearIdleTimer();
  if (!isConnected()) {
    logger.info("listener arrived after idle disconnect, reconnecting voice");
    try {
      await connectVoice(channel);
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        "voice reconnect failed on listener arrival",
      );
      return;
    }
  }
  logger.info("first listener present, resuming output");
  void playCurrent();
};

const onListenersLeft = (channel: VoiceChannel): void => {
  logger.info("voice channel empty, pausing output");
  stopPlayback();
  clearIdleTimer();
  const ms = config.IDLE_DISCONNECT_MINUTES * 60_000;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (countHumans(channel) === 0) {
      logger.info(
        { minutes: config.IDLE_DISCONNECT_MINUTES },
        "idle for too long, disconnecting voice",
      );
      disconnectVoice();
    }
  }, ms);
};

/**
 * Listen for voiceStateUpdate on the configured voice channel and drive the
 * audio player's output transmission accordingly. The virtual timeline keeps
 * running independently — we only gate transmission, not progress (D7).
 */
export const installVoicePresence = (channel: VoiceChannel): void => {
  watchedChannel = channel;
  lastHumanCount = countHumans(channel);

  const client = getClient();
  client.on(Events.VoiceStateUpdate, (oldState: VoiceState, newState: VoiceState) => {
    const involvesUs =
      oldState.channelId === channel.id || newState.channelId === channel.id;
    if (!involvesUs) return;

    // Re-fetch the live channel so we count members from the fresh cache.
    const live = client.channels.cache.get(channel.id) as VoiceChannel | undefined;
    if (!live) return;

    const count = countHumans(live);
    if (count === lastHumanCount) return;

    if (lastHumanCount === 0 && count > 0) {
      void onListenersArrived(live);
    } else if (count === 0 && lastHumanCount > 0) {
      onListenersLeft(live);
    }
    lastHumanCount = count;
  });

  // Initial state: if someone is already in the room when we boot, kick
  // playback; otherwise immediately schedule the idle disconnect timer so we
  // don't sit on a voice connection forever.
  if (lastHumanCount > 0) {
    logger.info({ humans: lastHumanCount }, "listeners already present at boot");
    void playCurrent();
  } else {
    onListenersLeft(channel);
  }
  logger.info(
    { initialHumans: lastHumanCount },
    "voice presence listener installed",
  );
};

export const teardownVoicePresence = (): void => {
  clearIdleTimer();
  watchedChannel = null;
  lastHumanCount = 0;
};
