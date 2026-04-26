export type Track = {
  youtubeId: string;
  url: string;
  title: string;
  uploader: string;
  durationSec: number;
  addedAt: string;
  addedByMessageId: string;
};

export type State = {
  tracks: Track[];
  currentIndex: number;
  trackStartedAt: string;
  lastSeenMessageId?: string;
};
