import type { VoiceChannel } from "discord.js";
import { logger } from "../logger.js";
import { getStore } from "../playlist/store.js";
import { currentPosition } from "../playlist/timeline.js";

// Discord caps voice channel status at ~500 chars; keep some headroom.
const MAX_LEN = 480;
// Poll cadence. Tracks are typically several minutes long, so 10s puts the
// title in sync within a fraction of a track-length without spamming
// Discord. The cache below means only *actual* title changes hit the API.
const POLL_MS = 10_000;

let channel: VoiceChannel | null = null;
let lastSet: string | null = null;
let pollTimer: NodeJS.Timeout | null = null;

const truncate = (s: string): string =>
  s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s;

const computeStatus = (): string | null => {
  const pos = currentPosition(getStore().getState(), new Date());
  if (!pos) return null;
  return `♪ ${pos.track.uploader} — ${pos.track.title}`;
};

const pushStatus = async (next: string | null): Promise<void> => {
  if (!channel) return;
  const value = next === null ? null : truncate(next);
  if (value === lastSet) return;

  try {
    await channel.client.rest.put(
      `/channels/${channel.id}/voice-status` as `/${string}`,
      { body: { status: value ?? "" } },
    );
    lastSet = value;
    logger.debug({ status: value }, "voice channel status set");
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, status: value },
      "failed to set voice channel status (missing permission?)",
    );
  }
};

const tick = (): void => {
  void pushStatus(computeStatus());
};

/**
 * Bind the module to the voice channel whose status we'll push.
 * Idempotent; safe to call once at boot.
 */
export const installChannelStatus = (vc: VoiceChannel): void => {
  channel = vc;
};

/**
 * Trigger an immediate status update against the current timeline. Useful
 * for callers that just mutated the queue and don't want to wait for the
 * next poll tick.
 */
export const refreshChannelStatus = (): void => tick();

/**
 * Start the background poller. Reads `currentPosition(state, now)` every
 * POLL_MS and pushes the resulting title to Discord — independent of
 * whether anyone is listening, so people browsing the server sidebar see
 * what's "on air" and can decide to jump in. The lastSet cache means equal
 * updates are dropped before they hit Discord's rate limiter.
 */
export const startChannelStatusSync = (): void => {
  stopChannelStatusSync();
  tick(); // push immediately at start
  pollTimer = setInterval(tick, POLL_MS);
  logger.info({ pollMs: POLL_MS }, "voice channel status sync started");
};

export const stopChannelStatusSync = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

export const clearChannelStatus = (): Promise<void> => pushStatus(null);
