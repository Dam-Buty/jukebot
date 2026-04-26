import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderQueue } from "./list.js";
import type { State, Track } from "../playlist/types.js";

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");

const makeTrack = (overrides: Partial<Track> = {}): Track => ({
  youtubeId: overrides.youtubeId ?? "abc",
  url: overrides.url ?? "https://youtu.be/abc",
  title: overrides.title ?? "Some Track",
  uploader: overrides.uploader ?? "Some Artist",
  durationSec: overrides.durationSec ?? 180,
  addedAt: overrides.addedAt ?? "2025-01-01T00:00:00.000Z",
  addedByMessageId: overrides.addedByMessageId ?? "m1",
});

const makeState = (overrides: Partial<State> = {}): State => ({
  tracks: overrides.tracks ?? [],
  currentIndex: overrides.currentIndex ?? 0,
  trackStartedAt: overrides.trackStartedAt ?? "2025-01-01T00:00:00.000Z",
});

describe("renderQueue", () => {
  it("renders RADIO SILENT when the queue is empty", () => {
    const out = stripAnsi(renderQueue(makeState(), new Date()));
    assert.match(out, /RADIO SILENT/);
    assert.match(out, /Queue is empty/);
  });

  it("renders NOW STREAMING with the current track and a progress bar", () => {
    const state = makeState({
      tracks: [makeTrack({ title: "Around the World", uploader: "Daft Punk", durationSec: 428 })],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const now = new Date("2025-01-01T00:03:42.000Z"); // 3:42 in
    const out = stripAnsi(renderQueue(state, now));
    assert.match(out, /NOW STREAMING/);
    assert.match(out, /Daft Punk — Around the World/);
    assert.match(out, /3:42 \/ 7:08/);
    // bar contains both filled and empty glyphs
    assert.ok(out.includes("▰") && out.includes("▱"));
  });

  it("includes UP NEXT for multi-track queues", () => {
    const state = makeState({
      tracks: [
        makeTrack({ title: "A", uploader: "X", durationSec: 30 }),
        makeTrack({ youtubeId: "b", title: "B", uploader: "X", durationSec: 60 }),
        makeTrack({ youtubeId: "c", title: "C", uploader: "X", durationSec: 90 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const out = stripAnsi(renderQueue(state, new Date("2025-01-01T00:00:10.000Z")));
    assert.match(out, /UP NEXT/);
    assert.match(out, /02.*X — B/);
    assert.match(out, /03.*X — C/);
  });

  it("wraps around for UP NEXT when current is near end of queue", () => {
    const state = makeState({
      tracks: [
        makeTrack({ youtubeId: "a", title: "A", uploader: "X", durationSec: 60 }),
        makeTrack({ youtubeId: "b", title: "B", uploader: "X", durationSec: 60 }),
        makeTrack({ youtubeId: "c", title: "C", uploader: "X", durationSec: 60 }),
      ],
      currentIndex: 2,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const out = stripAnsi(renderQueue(state, new Date("2025-01-01T00:00:10.000Z")));
    // Up next from track 3 should wrap to 1, 2.
    assert.match(out, /01.*X — A/);
    assert.match(out, /02.*X — B/);
  });

  it("stays under Discord's 2000 char message limit even with huge queues", () => {
    const tracks = Array.from({ length: 500 }, (_, i) =>
      makeTrack({
        youtubeId: `id${i}`,
        title: `Track ${i} with a kinda long descriptive title`,
        uploader: `Uploader Name ${i}`,
        durationSec: 200 + i,
      }),
    );
    const state = makeState({
      tracks,
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const out = renderQueue(state, new Date("2025-01-01T00:00:30.000Z"));
    assert.ok(out.length <= 1900, `output should fit, got ${out.length} chars`);
  });

  it("formats the loop summary", () => {
    const state = makeState({
      tracks: [
        makeTrack({ durationSec: 60 }),
        makeTrack({ youtubeId: "b", durationSec: 120 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const out = stripAnsi(renderQueue(state, new Date("2025-01-01T00:00:10.000Z")));
    assert.match(out, /2 tracks in loop, total 3:00/);
  });
});
