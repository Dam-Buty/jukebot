import { logger } from "../logger.js";
import { getStore } from "../playlist/store.js";
import { currentPosition } from "../playlist/timeline.js";
import { onPlayerEvent, playTrack, stopPlayback } from "./player.js";

export type ListenerProbe = () => boolean;

let hasListenersProbe: ListenerProbe = () => true;
let isReplaying = false;

const FAILURE_BACKOFF_MS = 750;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Play whatever the timeline says should be playing right now.
 *
 * Re-entrant: a follow-up call (e.g., from track-finished) waits for any
 * in-flight invocation rather than racing two ffmpeg pipelines.
 *
 * Skips when there is no human in the voice channel — D7 says the timeline
 * keeps advancing in silence; we just don't transmit.
 */
export const playCurrent = async (): Promise<void> => {
  if (isReplaying) return;
  isReplaying = true;
  try {
    const store = getStore();
    const pos = currentPosition(store.getState(), new Date());
    if (!pos) {
      logger.info("queue empty, radio silent");
      return;
    }
    if (!hasListenersProbe()) {
      logger.debug("no listeners present, deferring playback");
      return;
    }

    try {
      await playTrack(pos.track, pos.offsetSec);
    } catch (err) {
      logger.error(
        { err: (err as Error).message, track: pos.track.title, index: pos.index },
        "playTrack failed, removing track from queue",
      );
      // Permanent failure to start (video removed, age-gated, region-locked,
      // …) — drop it so we don't waste a full loop pass retrying every time.
      // If it was a transient error, the user can re-post and the live ingest
      // will queue it back up.
      store.removeTrackAt(pos.index);
      // Small backoff so a queue full of broken tracks doesn't pin CPU.
      await sleep(FAILURE_BACKOFF_MS);
      isReplaying = false;
      void playCurrent();
      return;
    }
  } finally {
    isReplaying = false;
  }
};

/**
 * Truncate the current playback and start fresh from whatever the timeline
 * says is current. Used by /reset-playlist after a queue swap.
 */
export const restartFromCurrent = async (): Promise<void> => {
  stopPlayback();
  await playCurrent();
};

/**
 * Wire the player and the store together: track-finished → advance + replay,
 * tracks-changed (empty → non-empty) → kickstart playback.
 *
 * `hasListeners` is injected so this module doesn't need to know about
 * Discord state directly (avoids a cyclic import with voicePresence).
 */
export const installPlaybackOrchestration = (hasListeners: ListenerProbe): void => {
  hasListenersProbe = hasListeners;
  const store = getStore();

  onPlayerEvent("track-finished", (err) => {
    if (err) {
      // Mid-stream playback failure — drop the offending track instead of
      // advancing past it, so the next loop pass doesn't trip on it again.
      const cur = currentPosition(store.getState(), new Date());
      if (cur) {
        logger.warn(
          { err: err.message, track: cur.track.title, index: cur.index },
          "track errored mid-playback, removing from queue",
        );
        store.removeTrackAt(cur.index);
      } else {
        logger.warn({ err: err.message }, "track errored, queue already empty");
      }
    } else {
      store.markEndOfTrack();
    }
    void playCurrent();
  });

  let lastTrackCount = store.getState().tracks.length;
  store.on("tracks-changed", () => {
    const count = store.getState().tracks.length;
    if (lastTrackCount === 0 && count > 0) {
      logger.info("queue went from empty to non-empty, starting playback");
      void playCurrent();
    }
    lastTrackCount = count;
  });
};
