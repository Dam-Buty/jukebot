const YT_ID = "[A-Za-z0-9_-]{11}";
const YT_PLAYLIST_ID = "[A-Za-z0-9_-]+";

const patterns = {
  watch: new RegExp(
    `(?:https?://)?(?<!\\.)(?:www\\.)?youtube\\.com/watch\\?v=(${YT_ID})(?:&\\S*)?`,
    "g",
  ),
  short: new RegExp(`(?:https?://)?youtu\\.be/(${YT_ID})`, "g"),
  shorts: new RegExp(
    `(?:https?://)?(?<!\\.)(?:www\\.)?youtube\\.com/shorts/(${YT_ID})`,
    "g",
  ),
  music: new RegExp(`(?:https?://)?music\\.youtube\\.com/watch\\?v=(${YT_ID})(?:&\\S*)?`, "g"),
  playlist: new RegExp(
    `(?:https?://)?(?<!\\.)(?:www\\.)?youtube\\.com/playlist\\?list=(${YT_PLAYLIST_ID})`,
    "g",
  ),
};

export type DetectedUrl =
  | { type: "track"; videoId: string; url: string }
  | { type: "playlist"; playlistId: string; url: string };

const normalizeUrl = (url: string): string => {
  if (!url.startsWith("http")) {
    return `https://${url}`;
  }
  return url;
};

const hasListParam = (url: string): boolean => /[?&]list=([A-Za-z0-9_-]+)/.test(url);

const hasIndexParam = (url: string): boolean => /[?&]index=\d+/.test(url);

export const detectUrls = (text: string): DetectedUrl[] => {
  const results: DetectedUrl[] = [];
  const seen = new Set<string>();

  // First: dedicated playlist URLs
  for (const match of text.matchAll(patterns.playlist)) {
    const url = normalizeUrl(match[0]);
    if (!seen.has(url)) {
      seen.add(url);
      results.push({ type: "playlist", playlistId: match[1], url });
    }
  }

  // Second: individual track URLs
  const individualPatterns = [patterns.watch, patterns.short, patterns.shorts, patterns.music];
  for (const pattern of individualPatterns) {
    for (const match of text.matchAll(pattern)) {
      const url = normalizeUrl(match[0]);
      if (seen.has(url)) continue;

      // If the watch URL has a list param but no index param, treat as playlist
      if (hasListParam(url) && !hasIndexParam(url)) {
        const listMatch = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
        if (listMatch) {
          seen.add(url);
          results.push({ type: "playlist", playlistId: listMatch[1], url });
          continue;
        }
      }

      seen.add(url);
      results.push({ type: "track", videoId: match[1], url });
    }
  }

  return results;
};
