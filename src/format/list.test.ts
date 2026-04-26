import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { relativeTime, renderQueue } from "./list.js";
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
  ...(overrides.addedBy !== undefined ? { addedBy: overrides.addedBy } : {}),
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

  it("shows who added the current track and when, relative to now", () => {
    const state = makeState({
      tracks: [
        makeTrack({
          title: "Around the World",
          uploader: "Daft Punk",
          durationSec: 428,
          addedBy: "chad",
          addedAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    // Two days after the track was added.
    const out = stripAnsi(renderQueue(state, new Date("2025-01-03T00:00:30.000Z")));
    assert.match(out, /added by chad · 2d ago/);
  });

  it("shows the author next to UP NEXT entries", () => {
    const state = makeState({
      tracks: [
        makeTrack({ title: "A", uploader: "X", durationSec: 30, addedBy: "alice" }),
        makeTrack({ youtubeId: "b", title: "B", uploader: "X", durationSec: 60, addedBy: "bob" }),
        makeTrack({ youtubeId: "c", title: "C", uploader: "X", durationSec: 90, addedBy: "carol" }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const out = stripAnsi(renderQueue(state, new Date("2025-01-01T00:00:05.000Z")));
    assert.match(out, /02 .*X — B.* +bob/);
    assert.match(out, /03 .*X — C.* +carol/);
  });

  it("falls back to '?' when a track has no addedBy (legacy state.json)", () => {
    const state = makeState({
      tracks: [
        makeTrack({ title: "Untitled", durationSec: 100 }),
        makeTrack({ youtubeId: "b", title: "Other", durationSec: 100 }),
      ],
      currentIndex: 0,
      trackStartedAt: "2025-01-01T00:00:00.000Z",
    });
    const out = stripAnsi(renderQueue(state, new Date("2025-01-01T00:00:10.000Z")));
    assert.match(out, /added by \?/);
  });
});

describe("relativeTime", () => {
  const ref = new Date("2025-06-15T12:00:00.000Z");

  it("returns 'just now' for ages under 45s", () => {
    assert.equal(relativeTime("2025-06-15T11:59:30.000Z", ref), "just now");
  });

  it("returns minutes for under an hour", () => {
    assert.equal(relativeTime("2025-06-15T11:30:00.000Z", ref), "30m ago");
  });

  it("returns hours for under a day", () => {
    assert.equal(relativeTime("2025-06-15T05:00:00.000Z", ref), "7h ago");
  });

  it("returns 'yesterday' at exactly one day", () => {
    assert.equal(relativeTime("2025-06-14T11:00:00.000Z", ref), "yesterday");
  });

  it("returns days under a month", () => {
    assert.equal(relativeTime("2025-06-10T12:00:00.000Z", ref), "5d ago");
  });

  it("returns months under a year", () => {
    assert.equal(relativeTime("2025-01-15T12:00:00.000Z", ref), "5mo ago");
  });

  it("returns years for older entries", () => {
    assert.equal(relativeTime("2022-06-15T12:00:00.000Z", ref), "3y ago");
  });
});
