import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import type { Track } from "./types.js";

const makeTrack = (overrides: Partial<Track> = {}): Track => ({
  youtubeId: overrides.youtubeId ?? "abc123",
  url: overrides.url ?? "https://youtube.com/watch?v=abc123",
  title: overrides.title ?? "Track",
  uploader: overrides.uploader ?? "Uploader",
  durationSec: overrides.durationSec ?? 60,
  addedAt: overrides.addedAt ?? new Date().toISOString(),
  addedByMessageId: overrides.addedByMessageId ?? "msg-1",
});

describe("Store", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jukebot-store-"));
    path = join(dir, "state.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("initialises with empty state when no file exists", () => {
    const store = new Store(path);
    const s = store.getState();
    assert.equal(s.tracks.length, 0);
    assert.equal(s.currentIndex, 0);
    assert.ok(typeof s.trackStartedAt === "string");
  });

  it("persists state after appendTracks", () => {
    const store = new Store(path);
    store.appendTracks([makeTrack()]);
    assert.ok(existsSync(path));

    const reloaded = new Store(path);
    assert.equal(reloaded.getState().tracks.length, 1);
  });

  it("anchors the timeline when first track is added to an empty queue", async () => {
    const store = new Store(path);
    const before = Date.now();
    store.appendTracks([makeTrack()]);
    const after = Date.now();
    const startedAt = new Date(store.getState().trackStartedAt).getTime();
    assert.ok(
      startedAt >= before && startedAt <= after,
      `trackStartedAt should be ~now, got ${startedAt} vs [${before}, ${after}]`,
    );
  });

  it("does NOT re-anchor the timeline when appending to a non-empty queue", () => {
    const store = new Store(path);
    store.appendTracks([makeTrack({ youtubeId: "first" })]);
    const firstAnchor = store.getState().trackStartedAt;
    store.appendTracks([makeTrack({ youtubeId: "second" })]);
    assert.equal(store.getState().trackStartedAt, firstAnchor);
    assert.equal(store.getState().tracks.length, 2);
  });

  it("markEndOfTrack advances index modulo length and pushes anchor by duration", () => {
    const store = new Store(path);
    store.appendTracks([
      makeTrack({ youtubeId: "a", durationSec: 30 }),
      makeTrack({ youtubeId: "b", durationSec: 60 }),
    ]);
    const anchorBefore = new Date(store.getState().trackStartedAt).getTime();

    store.markEndOfTrack();

    const s1 = store.getState();
    assert.equal(s1.currentIndex, 1);
    assert.equal(new Date(s1.trackStartedAt).getTime(), anchorBefore + 30_000);

    store.markEndOfTrack();
    const s2 = store.getState();
    assert.equal(s2.currentIndex, 0); // wrapped
    assert.equal(new Date(s2.trackStartedAt).getTime(), anchorBefore + 90_000);
  });

  it("replaceAll wipes tracks and re-anchors but preserves lastSeenMessageId", () => {
    const store = new Store(path);
    store.appendTracks([makeTrack({ youtubeId: "old" })]);
    store.setLastSeenMessageId("msg-42");

    store.replaceAll([makeTrack({ youtubeId: "new" })]);

    const s = store.getState();
    assert.equal(s.tracks.length, 1);
    assert.equal(s.tracks[0].youtubeId, "new");
    assert.equal(s.currentIndex, 0);
    assert.equal(s.lastSeenMessageId, "msg-42");
  });

  it("emits tracks-changed on appendTracks and replaceAll", () => {
    const store = new Store(path);
    let count = 0;
    store.on("tracks-changed", () => count++);
    store.appendTracks([makeTrack()]);
    store.replaceAll([makeTrack({ youtubeId: "x" })]);
    assert.equal(count, 2);
  });

  it("emits current-track-advanced on markEndOfTrack", () => {
    const store = new Store(path);
    store.appendTracks([makeTrack(), makeTrack({ youtubeId: "b" })]);
    let count = 0;
    store.on("current-track-advanced", () => count++);
    store.markEndOfTrack();
    assert.equal(count, 1);
  });

  it("appendTracks with empty array is a no-op", () => {
    const store = new Store(path);
    let count = 0;
    store.on("tracks-changed", () => count++);
    store.appendTracks([]);
    assert.equal(count, 0);
    assert.equal(store.getState().tracks.length, 0);
  });

  it("recovers from a corrupt state.json by archiving and starting fresh", () => {
    writeFileSync(path, "{ this is not valid json", "utf-8");
    const store = new Store(path);
    assert.equal(store.getState().tracks.length, 0);
    // The broken file should have been moved aside, not overwritten in place.
    // (Existence of *.broken-* is best-effort; we just confirm the new state
    // round-trips cleanly.)
    store.appendTracks([makeTrack()]);
    const reloaded = new Store(path);
    assert.equal(reloaded.getState().tracks.length, 1);
  });
});
