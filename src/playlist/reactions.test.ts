import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasNegativeReaction } from "./reactions.js";

const reactions = (
  ...emojis: (string | null)[]
): Iterable<{ emoji: { name: string | null } }> =>
  emojis.map((name) => ({ emoji: { name } }));

describe("hasNegativeReaction", () => {
  it("returns true when ❌ is among the reactions", () => {
    assert.equal(hasNegativeReaction(reactions("❌")), true);
  });

  it("returns true when ❌ sits alongside other reactions", () => {
    assert.equal(hasNegativeReaction(reactions("✅", "❌", "👍")), true);
  });

  it("returns false when only positive reactions are present", () => {
    assert.equal(hasNegativeReaction(reactions("✅")), false);
    assert.equal(hasNegativeReaction(reactions("✅", "👍")), false);
  });

  it("returns false on a message with no reactions", () => {
    assert.equal(hasNegativeReaction(reactions()), false);
  });

  it("ignores reactions whose name happens to be null (e.g. some custom emoji)", () => {
    assert.equal(hasNegativeReaction(reactions(null, "✅")), false);
  });

  it("does not match a different X-shaped emoji", () => {
    // ✖ (U+2716 HEAVY MULTIPLICATION X) is not the same as ❌ (U+274C).
    assert.equal(hasNegativeReaction(reactions("✖")), false);
  });
});
