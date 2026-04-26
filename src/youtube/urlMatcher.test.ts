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
});
