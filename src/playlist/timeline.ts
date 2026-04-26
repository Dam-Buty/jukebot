import type { State, Track } from "./types.js";

/**
 * The timeline is a virtual clock running over an infinite loop of `tracks`
 * (cf. CLAUDE.md D12). The state encodes a single anchor:
 *
 *   `state.tracks[currentIndex]` started playing at `state.trackStartedAt`.
 *
 * Given any `now`, we can derive (index, offsetSec) by walking forward
 * through the loop, with elapsed time taken modulo the total loop duration.
 */

const totalDurationMs = (tracks: Track[]): number =>
  tracks.reduce((sum, t) => sum + t.durationSec * 1000, 0);

const resolvePosition = (
  tracks: Track[],
  anchorIndex: number,
  anchorStartedAtMs: number,
  nowMs: number,
): { index: number; trackStartedAtMs: number; offsetMs: number } => {
  const total = totalDurationMs(tracks);
  // Step 1: collapse however many full loops have passed since the anchor.
  let elapsed = nowMs - anchorStartedAtMs;
  if (elapsed < 0) elapsed = 0; // clock skew / pre-anchor query
  elapsed = elapsed % total;

  // Step 2: walk forward from anchorIndex, peeling off track durations until
  // `elapsed` lands inside one.
  let idx = ((anchorIndex % tracks.length) + tracks.length) % tracks.length;
  while (elapsed >= tracks[idx].durationSec * 1000) {
    elapsed -= tracks[idx].durationSec * 1000;
    idx = (idx + 1) % tracks.length;
  }

  return {
    index: idx,
    trackStartedAtMs: nowMs - elapsed,
    offsetMs: elapsed,
  };
};

/**
 * Project the timeline forward to `now`, returning a fresh State whose
 * `currentIndex` and `trackStartedAt` describe the track that should be
 * playing right now. Pure: never mutates the input.
 *
 * For an empty queue, returns the input unchanged.
 */
export const tickToNow = (state: State, now: Date): State => {
  if (state.tracks.length === 0) return state;

  const anchorMs = new Date(state.trackStartedAt).getTime();
  const { index, trackStartedAtMs } = resolvePosition(
    state.tracks,
    state.currentIndex,
    anchorMs,
    now.getTime(),
  );

  // Fast path: no change needed, return input by reference.
  if (index === state.currentIndex && trackStartedAtMs === anchorMs) {
    return state;
  }

  return {
    ...state,
    currentIndex: index,
    trackStartedAt: new Date(trackStartedAtMs).toISOString(),
  };
};

/**
 * Inspect the timeline at `now` without producing a new State.
 * Returns null when the queue is empty (radio silence per D12).
 */
export const currentPosition = (
  state: State,
  now: Date,
): { index: number; offsetSec: number; track: Track } | null => {
  if (state.tracks.length === 0) return null;

  const anchorMs = new Date(state.trackStartedAt).getTime();
  const { index, offsetMs } = resolvePosition(
    state.tracks,
    state.currentIndex,
    anchorMs,
    now.getTime(),
  );

  return {
    index,
    offsetSec: offsetMs / 1000,
    track: state.tracks[index],
  };
};
