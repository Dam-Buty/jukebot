export type Track = {
  youtubeId: string;
  url: string;
  title: string;
  uploader: string;
  durationSec: number;
  addedAt: string;
  addedByMessageId: string;
  // Display name of the human who posted the link in the playlist channel.
  // Optional so older state.json files (pre this field) still load.
  addedBy?: string;
};

export type State = {
  tracks: Track[];
  currentIndex: number;
  trackStartedAt: string;
  lastSeenMessageId?: string;
};
