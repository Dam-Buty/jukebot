import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tickToNow, currentPosition } from "./timeline.js";
import type { State, Track } from "./types.js";

const makeTrack = (overrides: Partial<Track> = {}): Track => ({
  youtubeId: overrides.youtubeId ?? "test123",
  url: overrides.url ?? "https://youtube.com/watch?v=test123",
  title: overrides.title ?? "Test Track",
  uploader: overrides.uploader ?? "TestUploader",
  durationSec: overrides.durationSec ?? 60,
  addedAt: overrides.addedAt ?? "2025-01-01T00:00:00.000Z",
  addedByMessageId: overrides.addedByMessageId ?? "msg1",
});

const makeState = (overrides: Partial<State> = {}): State => {
  const base: State = {
    tracks: overrides.tracks ?? [],
    currentIndex: overrides.currentIndex ?? 0,
    trackStartedAt: overrides.trackStartedAt ?? "2025-01-01T00:00:00.000Z",
  };
  if (overrides.lastSeenMessageId !== undefined) {
    base.lastSeenMessageId = overrides.lastSeenMessageId;
  }
  return base;
};

describe("tickToNow", () => {
  it("returns same state when queue is empty", () => {
    const state = makeState({ tracks: [] });
    const result = tickToNow(state, new Date("2025-01-01T00:05:00.000Z"));
    assert.deepStrictEqual(result, state);
  });

  it("does not advance when now is within the current track", () => {
    const state = makeState({
      tracks: [makeTrack({ durationSec: 120 })],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const result = tickToNow(state, new Date("2025-01-01T00:01:00.000Z"));
    assert.equal(result.currentIndex, 0);
    assert.equal(result.trackStartedAt, "2025-01-01T00:00:00.000Z");
  });

  it("advances to next track when current is over", () => {
    const state = makeState({
      tracks: [
        makeTrack({ durationSec: 60 }),
        makeTrack({ youtubeId: "next", durationSec: 60 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const result = tickToNow(state, new Date("2025-01-01T00:01:10.000Z"));
    assert.equal(result.currentIndex, 1);
    assert.equal(result.trackStartedAt, "2025-01-01T00:01:00.000Z");
  });

  it("wraps around at end of queue (infinite loop, D12)", () => {
    const state = makeState({
      tracks: [
        makeTrack({ durationSec: 30 }),
        makeTrack({ youtubeId: "second", durationSec: 30 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    // Total loop = 60s. At 80s, we're 20s into track 0 of the second pass.
    const result = tickToNow(state, new Date("2025-01-01T00:01:20.000Z"));
    assert.equal(result.currentIndex, 0);
    assert.equal(result.trackStartedAt, "2025-01-01T00:01:00.000Z");
  });

  it("handles being multiple loops ahead", () => {
    const state = makeState({
      tracks: [
        makeTrack({ durationSec: 30 }),
        makeTrack({ youtubeId: "second", durationSec: 30 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    // 5 full 60s loops (= 300s) + 10s into track 0 of the 6th pass.
    const result = tickToNow(state, new Date("2025-01-01T00:05:10.000Z"));
    assert.equal(result.currentIndex, 0);
    assert.equal(result.trackStartedAt, "2025-01-01T00:05:00.000Z");
  });

  it("resolves correctly when anchor is mid-loop with non-zero index", () => {
    // Anchor: track 1 started at 00:00:30. Tracks: [30s, 30s].
    // At 00:00:30 we are 0s into track 1. At 00:01:00 we are 0s into track 0
    // of the next pass.
    const state = makeState({
      tracks: [
        makeTrack({ durationSec: 30 }),
        makeTrack({ youtubeId: "second", durationSec: 30 }),
      ],
      currentIndex: 1,
      trackStartedAt: "2025-01-01T00:00:30.000Z",
    });
    const result = tickToNow(state, new Date("2025-01-01T00:01:00.000Z"));
    assert.equal(result.currentIndex, 0);
    assert.equal(result.trackStartedAt, "2025-01-01T00:01:00.000Z");
  });

  it("preserves lastSeenMessageId", () => {
    const state = makeState({
      tracks: [makeTrack({ durationSec: 60 })],
      lastSeenMessageId: "last123",
    });
    const result = tickToNow(state, new Date("2025-01-01T00:02:00.000Z"));
    assert.equal(result.lastSeenMessageId, "last123");
  });

  it("does not mutate the input state", () => {
    const state = makeState({
      tracks: [makeTrack({ durationSec: 60 })],
    });
    const snapshot = structuredClone(state);
    tickToNow(state, new Date("2025-01-01T00:02:00.000Z"));
    assert.deepStrictEqual(state, snapshot);
  });

  it("handles clock skew (now before anchor) without crashing", () => {
    const state = makeState({
      tracks: [makeTrack({ durationSec: 60 })],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:01:00.000Z",
    });
    const result = tickToNow(state, new Date("2025-01-01T00:00:00.000Z"));
    assert.equal(result.currentIndex, 0);
  });
});

describe("currentPosition", () => {
  it("returns null when queue is empty", () => {
    const state = makeState({ tracks: [] });
    const result = currentPosition(state, new Date("2025-01-01T00:01:00.000Z"));
    assert.equal(result, null);
  });

  it("returns track and offset within current track", () => {
    const state = makeState({
      tracks: [makeTrack({ title: "Song A", durationSec: 120 })],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const result = currentPosition(state, new Date("2025-01-01T00:00:45.000Z"));
    assert.ok(result);
    assert.equal(result.track.title, "Song A");
    assert.ok(Math.abs(result.offsetSec - 45) < 0.01, `offset should be ~45, got ${result.offsetSec}`);
  });

  it("wraps around with a single track (offset = elapsed mod duration)", () => {
    // Single 30s track, asking at 60s → we're at the start of the second pass.
    const state = makeState({
      tracks: [makeTrack({ durationSec: 30 })],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const result = currentPosition(state, new Date("2025-01-01T00:01:00.000Z"));
    assert.ok(result);
    assert.equal(result.index, 0);
    assert.ok(result.offsetSec < 0.01, `expected ~0, got ${result.offsetSec}`);
  });

  it("returns next track when current is past the end", () => {
    const state = makeState({
      tracks: [
        makeTrack({ title: "Song A", durationSec: 30 }),
        makeTrack({ youtubeId: "songB", title: "Song B", durationSec: 60 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const result = currentPosition(state, new Date("2025-01-01T00:00:45.000Z"));
    assert.ok(result);
    assert.equal(result.track.title, "Song B");
    assert.ok(result.offsetSec > 14 && result.offsetSec <= 15.01);
  });

  it("wraps around through multiple tracks with correct offset", () => {
    const state = makeState({
      tracks: [
        makeTrack({ title: "Song A", durationSec: 30 }),
        makeTrack({ youtubeId: "songB", title: "Song B", durationSec: 30 }),
        makeTrack({ youtubeId: "songC", title: "Song C", durationSec: 60 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    // 30 (A) + 30 (B) + 10 into C = 70s elapsed
    const result = currentPosition(state, new Date("2025-01-01T00:01:10.000Z"));
    assert.ok(result);
    assert.equal(result.track.title, "Song C");
    assert.ok(Math.abs(result.offsetSec - 10) < 0.01);
  });

  it("returns 0 offset at the exact start of the next track", () => {
    // Track A (30s) starts at 00:00:00; at 00:00:30 we should be at offset 0
    // of track B.
    const state = makeState({
      tracks: [
        makeTrack({ title: "Song A", durationSec: 30 }),
        makeTrack({ youtubeId: "songB", title: "Song B", durationSec: 60 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const result = currentPosition(state, new Date("2025-01-01T00:00:30.000Z"));
    assert.ok(result);
    assert.equal(result.track.title, "Song B");
    assert.ok(result.offsetSec < 0.01, `expected ~0, got ${result.offsetSec}`);
  });
});
