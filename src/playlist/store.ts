import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../logger.js";
import { atomicWrite } from "../util/atomicWrite.js";
import type { State, Track } from "./types.js";

export type StoreEvent = "tracks-changed" | "current-track-advanced";

const DEFAULT_STATE_PATH = "data/state.json";

const emptyState = (): State => ({
  tracks: [],
  currentIndex: 0,
  trackStartedAt: new Date().toISOString(),
});

const isValidState = (value: unknown): value is State => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.tracks) &&
    typeof v.currentIndex === "number" &&
    typeof v.trackStartedAt === "string" &&
    (v.lastSeenMessageId === undefined || typeof v.lastSeenMessageId === "string")
  );
};

/**
 * Single source of truth for the live queue + virtual clock anchor.
 * Persists to `data/state.json` after every mutation (atomic write).
 * Cf. CLAUDE.md D4 and D12.
 */
export class Store {
  private state: State;
  private readonly emitter = new EventEmitter();

  constructor(private readonly statePath: string = DEFAULT_STATE_PATH) {
    mkdirSync(dirname(this.statePath), { recursive: true });
    this.state = this.load();
  }

  /** Read-only snapshot. Callers must not mutate. */
  getState(): Readonly<State> {
    return this.state;
  }

  /**
   * Append tracks at the end of the loop. If the queue was empty, also
   * (re)anchor the timeline at `now` so the radio starts on the new track 0.
   */
  appendTracks(tracks: Track[]): void {
    if (tracks.length === 0) return;

    const wasEmpty = this.state.tracks.length === 0;
    this.state = {
      ...this.state,
      tracks: [...this.state.tracks, ...tracks],
      ...(wasEmpty
        ? { currentIndex: 0, trackStartedAt: new Date().toISOString() }
        : {}),
    };

    this.persist();
    this.emitter.emit("tracks-changed");
  }

  /**
   * Wipe the queue and replace it. Re-anchors the timeline at `now`.
   * Used by `/reset-playlist`. Preserves `lastSeenMessageId` so the
   * incremental backfill on next boot still does the right thing.
   */
  replaceAll(tracks: Track[]): void {
    this.state = {
      tracks,
      currentIndex: 0,
      trackStartedAt: new Date().toISOString(),
      ...(this.state.lastSeenMessageId
        ? { lastSeenMessageId: this.state.lastSeenMessageId }
        : {}),
    };
    this.persist();
    this.emitter.emit("tracks-changed");
  }

  /**
   * Called by the audio player when a track finishes naturally. Advances
   * the index modulo length and pushes `trackStartedAt` forward by exactly
   * the track's duration — incremental, not "snap to now", to avoid
   * accumulating async drift across track boundaries.
   */
  markEndOfTrack(): void {
    if (this.state.tracks.length === 0) return;

    const cur = this.state.tracks[this.state.currentIndex];
    const newStartedAtMs =
      new Date(this.state.trackStartedAt).getTime() + cur.durationSec * 1000;
    const nextIndex = (this.state.currentIndex + 1) % this.state.tracks.length;

    this.state = {
      ...this.state,
      currentIndex: nextIndex,
      trackStartedAt: new Date(newStartedAtMs).toISOString(),
    };

    this.persist();
    this.emitter.emit("current-track-advanced");
  }

  setLastSeenMessageId(id: string): void {
    this.state = { ...this.state, lastSeenMessageId: id };
    this.persist();
  }

  /**
   * Drop a track from the queue (typically after a permanent playback
   * failure: video removed, age-gated, region-locked, etc.). Indices and
   * the timeline anchor are adjusted so the radio carries on smoothly:
   *
   * - Removing a track *before* `currentIndex` shifts `currentIndex` left.
   * - Removing the *current* track keeps `currentIndex` pointed at what is
   *   now the same slot (the next track has shifted in), and re-anchors
   *   `trackStartedAt` to `now` so the new current starts from 0:00.
   * - Removing a track *after* `currentIndex` is invisible to playback.
   * - Removing the last track of the queue resets to the empty state.
   */
  removeTrackAt(index: number): void {
    const { tracks, currentIndex } = this.state;
    if (index < 0 || index >= tracks.length) return;

    const newTracks = [...tracks.slice(0, index), ...tracks.slice(index + 1)];

    if (newTracks.length === 0) {
      this.state = {
        ...this.state,
        tracks: newTracks,
        currentIndex: 0,
        trackStartedAt: new Date().toISOString(),
      };
    } else if (index < currentIndex) {
      // Earlier track removed — slide the index left, keep the anchor.
      this.state = {
        ...this.state,
        tracks: newTracks,
        currentIndex: currentIndex - 1,
      };
    } else if (index === currentIndex) {
      // Current track removed — same slot, re-anchor at now.
      this.state = {
        ...this.state,
        tracks: newTracks,
        currentIndex: currentIndex % newTracks.length,
        trackStartedAt: new Date().toISOString(),
      };
    } else {
      // Later track removed — current playback unaffected.
      this.state = { ...this.state, tracks: newTracks };
    }

    this.persist();
    this.emitter.emit("tracks-changed");
  }

  on(event: StoreEvent, listener: () => void): void {
    this.emitter.on(event, listener);
  }

  off(event: StoreEvent, listener: () => void): void {
    this.emitter.off(event, listener);
  }

  private persist(): void {
    try {
      atomicWrite(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      logger.error({ err, path: this.statePath }, "failed to persist state");
    }
  }

  private load(): State {
    if (!existsSync(this.statePath)) {
      logger.info({ path: this.statePath }, "no prior state, starting fresh");
      return emptyState();
    }

    try {
      const raw = readFileSync(this.statePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isValidState(parsed)) {
        throw new Error("state.json shape invalid");
      }
      logger.info(
        { path: this.statePath, tracks: parsed.tracks.length },
        "state loaded",
      );
      return parsed;
    } catch (err) {
      const archived = `${this.statePath}.broken-${Date.now()}`;
      try {
        renameSync(this.statePath, archived);
      } catch {
        // best-effort, ignore archive failure
      }
      logger.error(
        { err, archived },
        "state.json unreadable, archived and starting fresh",
      );
      return emptyState();
    }
  }
}

let instance: Store | null = null;

export const getStore = (): Store => {
  if (!instance) instance = new Store();
  return instance;
};
