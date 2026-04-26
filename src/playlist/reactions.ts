export const VETO_EMOJI = "❌";

export interface ReactionLike {
  emoji: { name: string | null };
}

/**
 * A `❌` reaction on a playlist-channel message is the user's way of saying
 * "this track does not belong in the queue" — either because the bot's
 * automatic ❌ marker (after a failed resolution) is still there, or because
 * a human added it to retroactively veto a track. Either way we honour it
 * and skip the message during ingest, backfill, and /reset-playlist.
 *
 * Takes a plain Iterable so tests can pass an array; production passes
 * `message.reactions.cache.values()`.
 */
export const hasNegativeReaction = (
  reactions: Iterable<ReactionLike>,
): boolean => {
  for (const r of reactions) {
    if (r.emoji.name === VETO_EMOJI) return true;
  }
  return false;
};
