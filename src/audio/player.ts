import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
  type VoiceConnection,
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
let subscribedConnection: VoiceConnection | null = null;
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
  const conn = getConnection();
  if (!conn) {
    throw new Error("voice connection not established; call connectVoice first");
  }
  // Track the *reference* of the connection we're subscribed to, not just
  // a boolean: after an idle disconnect + reconnect, getConnection returns
  // a fresh VoiceConnection and we must re-subscribe the player to it.
  // The old code's subscribed=true cache survived destruction of the
  // previous connection, leaving the player wired to nothing — playback
  // logs ran but no audio reached Discord.
  if (subscribedConnection === conn) return;
  conn.subscribe(player);
  subscribedConnection = conn;
  logger.debug("audio player subscribed to voice connection");
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
