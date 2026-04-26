import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectUrls } from "./urlMatcher.js";

describe("detectUrls", () => {
  it("detects standard youtube.com/watch?v= URLs", () => {
    const result = detectUrls("check this out: https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "track",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("detects youtu.be short links", () => {
    const result = detectUrls("https://youtu.be/dQw4w9WgXcQ is a classic");
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "track",
      videoId: "dQw4w9WgXcQ",
      url: "https://youtu.be/dQw4w9WgXcQ",
    });
  });

  it("detects youtube.com/shorts/ URLs", () => {
    const result = detectUrls("https://www.youtube.com/shorts/abc123xyz00");
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "track",
      videoId: "abc123xyz00",
      url: "https://www.youtube.com/shorts/abc123xyz00",
    });
  });

  it("detects music.youtube.com/watch?v= URLs", () => {
    const result = detectUrls("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "track",
      videoId: "dQw4w9WgXcQ",
      url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("detects playlist URLs", () => {
    const result = detectUrls("https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "playlist",
      playlistId: "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      url: "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    });
  });

  it("detects multiple URLs in one message", () => {
    const result = detectUrls(
      "First: https://youtu.be/aaa111bbb22\nSecond: https://www.youtube.com/watch?v=ccc333ddd44",
    );
    assert.equal(result.length, 2);
    assert.equal(result[0].type, "track");
    assert.equal(result[1].type, "track");
  });

  it("deduplicates identical URLs within a message", () => {
    const result = detectUrls("https://youtu.be/dQw4w9WgXcQ and https://youtu.be/dQw4w9WgXcQ");
    assert.equal(result.length, 1);
  });

  it("treats watch?v=...&list=... (no index) as a playlist", () => {
    const result = detectUrls(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    );
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "playlist",
      playlistId: "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    });
  });

  it("treats watch?v=...&list=...&index=N as a track (not playlist)", () => {
    const result = detectUrls(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&index=3",
    );
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "track",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&index=3",
    });
  });

  it("detects URLs without protocol prefix", () => {
    const result = detectUrls("youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "track");
    assert.equal(result[0].url, "https://youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("handles youtu.be without protocol", () => {
    const result = detectUrls("youtu.be/dQw4w9WgXcQ");
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://youtu.be/dQw4w9WgXcQ");
  });

  it("returns empty array for text without YouTube URLs", () => {
    const result = detectUrls("just some random text https://example.com");
    assert.equal(result.length, 0);
  });

  it("handles mixed individual tracks and playlists", () => {
    const result = detectUrls(
      "Track: https://youtu.be/aaa111bbb22\nPlaylist: https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    );
    assert.equal(result.length, 2);
    assert.equal(result[0].type, "playlist");
    assert.equal(result[1].type, "track");
  });

  it("skips watch URL already matched as playlist via list param", () => {
    const result = detectUrls(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf and https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    );
    // Both are playlists with same playlist ID, but different URLs → two entries
    assert.equal(result.length, 2);
    assert.equal(result[0].type, "playlist");
    assert.equal(result[1].type, "playlist");
  });

  it("handles watch URL with extra params besides list", () => {
    const result = detectUrls(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&t=30",
    );
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "playlist",
      playlistId: "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&t=30",
    });
  });

  // YouTube auto-generates a Mix (`list=RD…&start_radio=1`) when you click a
  // single video while autoplay is on. The user shared just a track — we must
  // not unfurl the entire endless radio.
  it("treats watch?v=X&list=RDX&start_radio=1 as a single track (YouTube Mix cruft)", () => {
    const result = detectUrls(
      "https://www.youtube.com/watch?v=oNL3aR5GjaQ&list=RDoNL3aR5GjaQ&start_radio=1",
    );
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], {
      type: "track",
      videoId: "oNL3aR5GjaQ",
      url: "https://www.youtube.com/watch?v=oNL3aR5GjaQ&list=RDoNL3aR5GjaQ&start_radio=1",
    });
  });

  it("treats watch?v=X&list=RDMM… (My Mix) as a single track", () => {
    const result = detectUrls(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDMMabcdef12345",
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "track");
    assert.equal((result[0] as { videoId: string }).videoId, "dQw4w9WgXcQ");
  });

  it("treats watch?v=X&list=RDCLAK5uy_… (YT Music auto-mix) as a single track", () => {
    const result = detectUrls(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDCLAK5uy_kFQXyqCRZ",
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "track");
    assert.equal((result[0] as { videoId: string }).videoId, "dQw4w9WgXcQ");
  });

  it("drops bare /playlist?list=RD… URLs (no video to fall back to)", () => {
    const result = detectUrls(
      "https://www.youtube.com/playlist?list=RDoNL3aR5GjaQ",
    );
    assert.equal(result.length, 0);
  });

  it("still expands user-curated /playlist?list=PL… and OL… URLs", () => {
    const pl = detectUrls(
      "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    );
    assert.equal(pl.length, 1);
    assert.equal(pl[0].type, "playlist");

    const ol = detectUrls(
      "https://www.youtube.com/playlist?list=OLAK5uy_kFQXyqCRZabcdef",
    );
    assert.equal(ol.length, 1);
    assert.equal(ol[0].type, "playlist");
  });
});
