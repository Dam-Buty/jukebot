import type { VoiceChannel } from "discord.js";
import { logger } from "../logger.js";

// Discord caps voice channel status at ~500 chars; keep some headroom.
const MAX_LEN = 480;

let channel: VoiceChannel | null = null;
let lastSet: string | null = null;

const truncate = (s: string): string =>
  s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s;

/**
 * Bind the module to the voice channel whose status we're going to push to.
 * Idempotent; safe to call once at boot.
 */
export const installChannelStatus = (vc: VoiceChannel): void => {
  channel = vc;
};

/**
 * Update (or clear with `null`) the voice channel status — the one-line
 * blurb shown under the channel name in Discord's sidebar.
 *
 * discord.js v14.26 doesn't expose a typed helper for this endpoint, so we
 * call the REST route directly. Caches the last-pushed value to skip
 * redundant API calls (the status doesn't move between mutations).
 */
export const setChannelStatus = async (status: string | null): Promise<void> => {
  if (!channel) return;
  const next = status === null ? null : truncate(status);
  if (next === lastSet) return;

  try {
    await channel.client.rest.put(
      `/channels/${channel.id}/voice-status` as `/${string}`,
      { body: { status: next ?? "" } },
    );
    lastSet = next;
    logger.debug({ status: next }, "voice channel status set");
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, status: next },
      "failed to set voice channel status (missing permission?)",
    );
  }
};

export const clearChannelStatus = (): Promise<void> => setChannelStatus(null);
