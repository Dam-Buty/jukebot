import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
} from "@discordjs/voice";
import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
import { getConnection } from "./voice.js";
import { createOpusStream, getDirectAudioUrl, type OpusStream } from "./ffmpeg.js";
import type { Track } from "../playlist/types.js";

export type PlayerEvent = "track-finished";
export type TrackFinishedListener = (error?: Error) => void;

const emitter = new EventEmitter();

const player: AudioPlayer = createAudioPlayer({
  behaviors: {
    // When no listener is in the voice channel, pause output rather than
    // consuming the stream into the void. Phase 7 will explicitly drive this.
    noSubscriber: NoSubscriberBehavior.Pause,
  },
});

let currentStream: OpusStream | null = null;
let subscribed = false;
let trackInProgress = false;
let stoppingIntentionally = false;

const emitFinished = (error?: Error): void => {
  if (!trackInProgress) return;
  trackInProgress = false;
  if (stoppingIntentionally) {
    stoppingIntentionally = false;
    return;
  }
  emitter.emit("track-finished", error);
};

player.on(AudioPlayerStatus.Idle, () => emitFinished());

player.on("error", (err) => {
  logger.error({ err: err.message }, "audio player error");
  emitFinished(err);
});

const ensureSubscribed = (): void => {
  if (subscribed) return;
  const conn = getConnection();
  if (!conn) {
    throw new Error("voice connection not established; call connectVoice first");
  }
  conn.subscribe(player);
  subscribed = true;
};

export const playTrack = async (track: Track, offsetSec: number): Promise<void> => {
  ensureSubscribed();

  if (currentStream) {
    currentStream.kill();
    currentStream = null;
  }

  logger.info(
    { title: track.title, durationSec: track.durationSec, offsetSec: offsetSec.toFixed(1) },
    "play track",
  );

  const directUrl = await getDirectAudioUrl(track.url);
  currentStream = createOpusStream(directUrl, offsetSec);

  const resource = createAudioResource(currentStream.stream, {
    inputType: StreamType.OggOpus,
  });

  trackInProgress = true;
  player.play(resource);
};

export const stopPlayback = (): void => {
  stoppingIntentionally = true;
  if (currentStream) {
    currentStream.kill();
    currentStream = null;
  }
  player.stop(true);
};

export const onPlayerEvent = (
  event: PlayerEvent,
  listener: TrackFinishedListener,
): void => {
  emitter.on(event, listener);
};
