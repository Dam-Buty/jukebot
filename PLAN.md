# PLAN.md — Plan d'implémentation jukebot

> **STATUS: complete.** Les 12 phases (0–11) décrites ici ont été
> livrées. Ce document est conservé tel quel, comme **archive
> historique** du plan d'attaque initial — l'ordre dans lequel les
> couches ont été montées, les choix d'implémentation faits en cours
> de route, les risques identifiés. Pour comprendre le code aujourd'hui,
> commence par le `README.md` (front door) puis `CLAUDE.md` (D1 → D19,
> les décisions de design).
>
> Quelques détails ont évolué par rapport au plan ci-dessous ; les
> écarts notables :
>
> - **Phase 9** prévoyait le full scan boot ; en pratique le boot fait
>   un scan **incrémental** (curseur `lastSeenMessageId` persisté à la
>   page), tournant en tâche de fond pour ne pas bloquer le démarrage.
>   `/reset-playlist` fait, lui, un full scan synchrone.
> - **Phase 11** prévoyait de tagger les tracks illisibles
>   (`unavailable: true`). En pratique on les **retire** de la queue
>   (cf. CLAUDE.md D16, `Store.removeTrackAt`).
> - Le veto ❌ par réaction (CLAUDE.md D17) n'était pas dans le plan ;
>   ajouté en cours de route, vit dans `src/playlist/reactions.ts`.
> - `Track` porte un `addedBy` et un `addedAt` dérivé de
>   `message.createdAt` (CLAUDE.md D18) — pas mentionné dans le plan
>   de Phase 4.

## Mapping rapide : décisions ↔ modules

| Décision (CLAUDE.md) | Module                                                   |
| -------------------- | -------------------------------------------------------- |
| D1 / D2              | `package.json`, `src/main.ts`                            |
| D3 / D19             | `src/youtube/ytdlp.ts`, `src/audio/ffmpeg.ts`            |
| D4 / D12             | `src/playlist/store.ts`, `src/util/atomicWrite.ts`       |
| D5 / D8 / D13        | `src/playlist/ingest.ts`, `src/youtube/urlMatcher.ts`    |
| D6                   | `src/discord/client.ts`                                  |
| D7                   | `src/playlist/timeline.ts`, `src/audio/playback.ts`      |
| D9                   | `src/discord/voicePresence.ts`                           |
| D10                  | `src/logger.ts`                                          |
| D11                  | `src/discord/commands.ts`, `src/format/list.ts`          |
| D14                  | `src/playlist/backfill.ts`, `src/discord/commands.ts`    |
| D15                  | `Dockerfile`, `docker-compose.yml`                       |
| D16                  | `src/audio/playback.ts`, `src/playlist/store.ts`         |
| D17                  | `src/playlist/reactions.ts`, `src/playlist/ingest.ts`    |
| D18                  | `src/playlist/types.ts`, `src/playlist/ingest.ts`        |

---

## Plan d'attaque originel (préservé tel quel ci-dessous)

Plan d'attaque détaillé avant écriture du code. Lire `CLAUDE.md` en premier
pour les décisions de design qui sous-tendent ce plan.

## Vue d'ensemble

```
┌─────────────────┐    posts URL     ┌──────────────────┐
│  user (Discord) │ ───────────────► │ #playlist (text) │
└─────────────────┘                  └────────┬─────────┘
                                              │ messageCreate
                                              ▼
                                   ┌────────────────────┐
                                   │  ingest.ts         │
                                   │  url match → meta  │
                                   │   (yt-dlp)         │
                                   └────────┬───────────┘
                                            │ append(Track)
                                            ▼
                                   ┌────────────────────┐
        snapshot ◄─── persist ─── │  store.ts (state)  │
        state.json                │  { tracks, idx,    │
                                  │    startedAt }     │
                                  └────────┬───────────┘
                                           │
                          ┌────────────────┴──────────────┐
                          │                               │
                          ▼                               ▼
                ┌──────────────────┐           ┌────────────────────┐
                │  timeline.ts     │           │  /list, /reset     │
                │  now → (idx,off) │           │  format/list.ts    │
                └────────┬─────────┘           └────────────────────┘
                         │ (idx, offsetSec)
                         ▼
                ┌──────────────────┐    voiceStateUpdate
                │  player.ts       │ ◄─────────────────────┐
                │  yt-dlp | ffmpeg │                       │
                │     -ss offset   │                ┌──────┴───────┐
                └────────┬─────────┘                │ voicePresence│
                         │ Opus stream              │     .ts      │
                         ▼                          └──────────────┘
                ┌──────────────────┐
                │  Discord voice   │
                │   #voice-channel │
                └──────────────────┘
```

## Phasage

L'ordre est conçu pour que chaque phase soit testable de bout en bout
indépendamment (au moins manuellement) avant de passer à la suivante.

### Phase 0 — Scaffolding TypeScript + Docker

**But** : projet TS qui compile et qui se lance dans un conteneur Docker,
rien d'autre.

**Tâches TypeScript** :
- `package.json` (`"type": "module"`, scripts `dev`, `build`, `start`).
- `tsconfig.json` strict, target `ES2022`, module `NodeNext`,
  `moduleResolution: NodeNext`, `outDir: dist`.
- `.env.example` listant les 5 vars de `SETUP.md` + `IDLE_DISCONNECT_MINUTES`,
  `LOG_LEVEL`, `NODE_ENV`.
- `src/main.ts` minimal : log "hello" et exit.
- Dépendances installées :
  - prod : `discord.js`, `@discordjs/voice`, `@discordjs/opus`,
    `libsodium-wrappers`, `pino`, `zod`
  - dev : `typescript`, `tsx`, `@types/node`, `pino-pretty`
- Scripts npm :
  - `dev` → `tsx watch src/main.ts`
  - `build` → `tsc`
  - `start` → `node dist/main.js` *(Docker fournit déjà l'env via
    `env_file:` dans compose ; le `--env-file=.env` natif Node n'est utile
    qu'en local sans Docker)*

**Tâches Docker** *(déjà scaffoldées en amont — `Dockerfile`,
`docker-compose.yml`, `.dockerignore` existent déjà ; reste à valider)* :
- Vérifier que `docker compose build` passe une fois `package.json` et
  `src/main.ts` en place.
- Vérifier que `docker compose up` log "hello" puis exit clean.
- Vérifier que `data/state.json` (créé manuellement avec `{}`) est bien
  persistant via le volume bind.

**Sortie attendue** : `npm run dev` log "hello" en local **et** `docker
compose up --build` log "hello" dans un conteneur.

---

### Phase 1 — Config & logger

**But** : un seul endroit où on charge / valide la config et où on récupère
le logger.

**Modules créés** :
- `src/config.ts` — schéma `zod` qui parse `process.env`. Refuse de démarrer
  si une var requise manque, message d'erreur clair listant ce qui manque.
- `src/logger.ts` — instance pino unique. Auto-détection : `pino-pretty` si
  `NODE_ENV !== 'production'`, JSON sinon. Niveau via `LOG_LEVEL`.

**Vars d'env** (cf. `.env.example`) :
- requis : `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`,
  `PLAYLIST_CHANNEL_ID`, `VOICE_CHANNEL_ID`
- optionnels : `IDLE_DISCONNECT_MINUTES` (default `15`),
  `LOG_LEVEL` (default `info`), `NODE_ENV` (default `development`)

**Sortie attendue** : un `import { config } from './config.js'` typé strict
+ logs jolis en dev.

---

### Phase 2 — Prerequisites check + Discord client

**But** : connexion à Discord OK + vérification que `yt-dlp` et `ffmpeg`
sont installés sur le système.

**Modules créés** :
- `src/util/prerequisites.ts` — exécute `yt-dlp --version` et
  `ffmpeg -version` au boot, log les versions ou refuse de démarrer.
- `src/discord/client.ts` — instancie `Client` avec les bons intents
  (`Guilds`, `GuildVoiceStates`, `GuildMessages`, `MessageContent`).
  Expose `getClient()` et le ready handler.

**Tâches** :
- `main.ts` orchestre : `await prerequisites()` → `await loginDiscord()`
  → log `bot connecté en tant que <tag> sur <guild>`.
- Dans le ready handler : récupérer la guild, le text channel, le voice
  channel via leurs IDs et valider qu'ils existent + que le bot a bien
  les permissions nécessaires. Si non → log et exit.

**Sortie attendue** : le bot apparaît "online" sur Discord ; les logs
montrent qu'il a trouvé la guild et les deux channels.

---

### Phase 3 — Extraction & metadata YouTube

**But** : transformer une URL postée en `Track` avec sa duration fiable.

**Modules créés** :
- `src/youtube/urlMatcher.ts` — regex pour détecter URLs YouTube dans un
  texte arbitraire. Distingue **tracks individuels** vs **playlists**.
  Patterns supportés :
  - `youtube.com/watch?v=ID` (et `&list=...` ignoré côté track)
  - `youtu.be/ID`
  - `youtube.com/shorts/ID`
  - `music.youtube.com/watch?v=ID`
  - `youtube.com/playlist?list=PLAYLIST_ID`
  - URL avec `&list=` *sans* `&index=` → on traite comme **playlist**
    (ambigu mais conservatif).
- `src/youtube/ytdlp.ts` — wrapper de subprocess (`child_process.spawn`)
  autour de `yt-dlp` :
  - `getTrackMeta(url)` → `{ id, title, uploader, duration, url }`
    via `yt-dlp --no-playlist --dump-json --skip-download <url>`
  - `expandPlaylist(url)` → `Track[]` :
    - étape 1 : `yt-dlp --flat-playlist --dump-json` pour les IDs
    - étape 2 : `Promise.all` (concurrence ≤ 4) sur `getTrackMeta` pour
      chaque ID afin d'avoir les durations fiables (cf. D7).
    - skip silencieusement les vidéos privées/supprimées (avec un log
      `warn`).

**Choix d'implémentation** :
- Pas de `ytdl-core` ni `play-dl` (cf. D3).
- On parse stdout (JSON par ligne pour `--flat-playlist`, JSON unique sinon).
- Timeout par appel yt-dlp : 30s, configurable plus tard si besoin.

**Sortie attendue** : appelable depuis un repl/test manuel, donne des
`Track[]` cohérents pour une vidéo seule comme pour une playlist.

---

### Phase 4 — Modèle de queue + horloge virtuelle

**But** : structures de données et math du clock, sans encore brancher la
voix.

**Modules créés** :
- `src/playlist/types.ts` :
  ```ts
  type Track = {
    youtubeId: string;
    url: string;
    title: string;
    uploader: string;
    durationSec: number;
    addedAt: string;             // ISO
    addedByMessageId: string;    // pour D14 / dedup logique si on revient
  };

  type State = {
    tracks: Track[];
    currentIndex: number;
    trackStartedAt: string;      // ISO; quand le track courant a commencé sur la timeline
    lastSeenMessageId?: string;  // pour le backfill incrémental
  };
  ```
- `src/playlist/timeline.ts` :
  - `tickToNow(state, now): State` — fait avancer `currentIndex` /
    `trackStartedAt` jusqu'à ce qu'on tombe dans un track qui n'est pas
    encore terminé. Boucle modulo `tracks.length`. Pure function.
  - `currentPosition(state, now): { index: number, offsetSec: number,
    track: Track } | null` — null si `tracks.length === 0`.
  - Couvert par tests unitaires (la math est facile à se planter).
- `src/playlist/store.ts` :
  - Charge `data/state.json` au boot, sinon initialise vide.
  - Mutations : `appendTracks(tracks)`, `replaceAll(tracks)` (pour reset),
    `markEndOfTrack()` (callback du player), `setLastSeenMessageId(id)`.
  - Persiste après *chaque* mutation via `util/atomicWrite.ts`
    (écrit `state.json.tmp` puis `rename`).
  - EventEmitter interne : émet `tracks-changed`, `current-track-advanced`
    pour découpler.
- `src/util/atomicWrite.ts` — utilitaire générique.

**Sortie attendue** : on peut, à la main dans `main.ts`, push 3 tracks et
voir le state se sérialiser dans `data/state.json`, puis demander
`currentPosition` à différents `now` futurs et observer le clock avancer.

---

### Phase 5 — Pipeline audio (sans encore l'horloge dynamique)

**But** : le bot rejoint le voice channel, joue **un** track depuis le
début, passe au suivant à la fin. Pas encore de seek ni de presence
handling.

**Modules créés** :
- `src/audio/voice.ts` — wrap `joinVoiceChannel` + `VoiceConnection`
  lifecycle. Expose `connect()`, `disconnect()`,
  `isConnected()`, et un `onConnectionDropped` pour reconnect.
- `src/audio/ffmpeg.ts` — fabrique un `Readable` Opus :
  - étape 1 : `yt-dlp -f bestaudio --no-playlist -g <url>` → URL directe.
  - étape 2 : `ffmpeg -ss <offsetSec> -i <directUrl> -f opus -acodec
    libopus -ar 48000 -ac 2 -b:a 128k -loglevel warning pipe:1` → stdout.
  - On gère `-ss` *avant* `-i` pour seek rapide (parfois imprécis ; OK pour
    notre usage).
- `src/audio/player.ts` — instancie un `AudioPlayer` (`@discordjs/voice`),
  abonne `voice.connection` à ce player. Expose :
  - `playTrack(track, startOffsetSec)` — créé une `AudioResource` à partir
    de `ffmpeg.ts` et la joue.
  - `stop()` — coupe la lecture.
  - Gestion du `AudioPlayerStatus.Idle` (= track fini) → callback
    `onTrackEnded`.

**Tâches main.ts** : au ready, si `state.tracks.length > 0`, joindre le
voice channel et `playTrack(state.tracks[0], 0)`. À la fin, idx++ et
recommencer.

**Sortie attendue** : tu peux push manuellement 2 tracks, le bot rejoint
le voice channel et les joue à la suite.

---

### Phase 6 — Branchement timeline ↔ player

**But** : la lecture utilise désormais `tickToNow` + `currentPosition` pour
décider quoi jouer et à quel offset. C'est ici que la "radio" naît.

**Tâches** :
- À chaque `start of track` (boot, fin de track précédent, reprise après
  reconnect) :
  1. `state = tickToNow(state, new Date())`.
  2. `pos = currentPosition(state, new Date())`.
  3. Si `pos === null` → restera idle (queue vide).
  4. Sinon → `player.playTrack(pos.track, pos.offsetSec)`.
- Au `onTrackEnded` du player :
  - On NE recalcule PAS depuis `now` brutalement ; on incrémente
    `currentIndex = (currentIndex + 1) % tracks.length` et on set
    `trackStartedAt = trackStartedAt + previousTrackDuration` pour ne pas
    accumuler de drift dû au timing async.
  - Puis `playTrack(nextTrack, 0)`.
- Sur `tracks-changed` (emit du store) :
  - Si la queue était vide → on démarre la timeline (`startedAt = now`,
    `idx = 0`) et on lance la lecture.
  - Si elle ne l'était pas → on ne touche à rien, le nouveau track sera
    pris au prochain wrap (cf. D12).

**Sortie attendue** : si on poste un nouveau track pendant une lecture, il
arrive dans la rotation. Si on stoppe le bot pendant 2 minutes au milieu
d'un track de 4 min puis qu'on le relance, il reprend à la position où la
timeline en serait (~2 min dans le track ou track suivant si dépassé).

---

### Phase 7 — Voice presence (pause auto / reconnect / idle disconnect)

**But** : implémenter D9.

**Modules créés** :
- `src/discord/voicePresence.ts` :
  - Listener `voiceStateUpdate` filtré sur le `VOICE_CHANNEL_ID`.
  - Compte le nombre d'humains (non-bots) présents dans le channel.
  - Transitions :
    - `humans 0 → ≥1` : si déconnecté, reconnect ; le `player.ts` prendra
      la position courante via `currentPosition` (donc seek mid-track).
      Si juste muet, unpause/replay.
    - `humans ≥1 → 0` : `player.stop()` (ou pause). Démarre un timer
      `IDLE_DISCONNECT_MINUTES`. Si toujours 0 quand le timer expire :
      `voice.disconnect()`.
- Important : la **timeline ne s'arrête jamais** (sauf D12 case `tracks
  vides`). C'est la diffusion qui s'arrête.

**Sortie attendue** : on entre dans le voice channel, ça joue ; on sort,
ça se tait. Au bout de 15 min sans personne, le bot quitte le channel
voice. Quand on revient, il reconnecte automatiquement et reprend là où la
timeline en est arrivée.

---

### Phase 8 — Ingestion live des messages playlist

**But** : ce que l'utilisateur perçoit comme "je colle un lien et ça part
dans la queue".

**Modules créés** :
- `src/playlist/ingest.ts` :
  - Listener `messageCreate` filtré sur `PLAYLIST_CHANNEL_ID`.
  - Ignore les messages du bot lui-même.
  - Extrait toutes les URLs YouTube via `urlMatcher`.
  - Pour chaque URL :
    - playlist → `expandPlaylist`
    - track → `getTrackMeta`
  - `store.appendTracks(tracks)` puis `store.setLastSeenMessageId(msg.id)`.
  - Reaction `✅` sur le message à succès, `❌` à échec total. (Cosmétique
    mais utile pour debug.)

**Sortie attendue** : tu colles un lien YouTube dans #playlist → il
apparaît dans la queue (vérifiable via `/list` qu'on construira en phase
10), et la radio le diffusera au prochain wrap.

---

### Phase 9 — Backfill au boot + `/reset-playlist`

**But** : implémenter D14.

**Modules touchés / créés** :
- `src/playlist/backfill.ts` — utilitaire pure de scan d'historique :
  - `scanChannel(channel, sinceMessageId?: string): Promise<Track[]>`
  - Pagination Discord : `channel.messages.fetch({ limit: 100, after: id })`
    en boucle.
  - Pour chaque message (oldest → newest), passe par le même pipeline
    `urlMatcher → ytdlp` que `ingest.ts` (mutualiser le code dans une
    fonction helper `extractTracksFromMessage`).
  - Renvoie la liste agrégée + le `lastSeenMessageId`.
- **Au boot** (orchestré dans `main.ts`) :
  - Si `state.json` existe et a `lastSeenMessageId` → `scanChannel` avec
    cet ID → `store.appendTracks(found)`.
  - Sinon → full scan → `store.replaceAll(found)`.
- **`/reset-playlist`** (dans `discord/commands.ts`) :
  - `interaction.deferReply()` (ça peut prendre un moment).
  - `tracks = await scanChannel(channel)` (pas de filtre).
  - `store.replaceAll(tracks)` — atomique, ne casse PAS la lecture en
    cours : le player garde sa ref au track courant jusqu'à la fin, puis
    bascule vers la nouvelle queue (idx=0, startedAt=now). *Ou alors* on
    coupe net pour clarté. **À trancher pendant l'implémentation,
    proposition par défaut : swap atomique sans couper.**
  - `interaction.editReply` avec un récap (`X tracks rebuilt from history`).

**Sortie attendue** : restart du bot → il rattrape les liens postés
pendant qu'il était down. `/reset-playlist` → il reconstruit tout depuis
zéro à partir du channel.

---

### Phase 10 — Slash command `/list` avec rendu ANSI

**But** : restituer joliment l'état de la radio.

**Modules créés** :
- `src/format/list.ts` :
  - Helper ANSI Discord (codes SGR : `\u001b[0;31m` red, `\u001b[1;33m`
    yellow bold, `\u001b[0m` reset).
  - Helper `progressBar(current, total, width)` : Unicode `▰`/`▱`.
  - `renderQueue(state, now): string` :
    - Header ASCII (cf. mock dans `CLAUDE.md` D11).
    - Now playing : index + titre + barre + `mm:ss / mm:ss`.
    - Up next : N suivants (default 10), avec wraparound clean
      (n'affiche pas "1/12" comme suivant si on est en train de le jouer).
    - Compteurs : queue size, total duration, time-into-loop si pertinent.
  - Garantie : sortie ≤ 1900 chars (marge sous la limite Discord 2000).
    Si débordement → tronquer la liste "up next".
- Dans `discord/commands.ts` :
  - Handler `/list` : `interaction.reply({ content: '```ansi\n' + render
    + '\n```' })`.

**Sortie attendue** : `/list` renvoie un beau code block coloré qui
montre exactement où on en est dans la loop.

---

### Phase 11 — Robustesse & failure modes

**But** : que ça ne casse pas pour des raisons stupides.

**Tâches** :
- **Track illisible** (vidéo retirée pendant la vie de la queue) : le
  `ffmpeg` plante → `player.ts` log warn et émet `onTrackEnded` comme si
  le track s'était terminé normalement. La timeline avance, on saute.
  Idéalement on retire le track de la queue (pour ne pas re-essayer à
  chaque tour) ou on le tag `unavailable: true` dans `Track` et on le
  skip silencieusement à chaque passage.
- **`state.json` corrompu** au boot : log error, on archive le fichier
  (`state.json.broken-<timestamp>`) et on repart d'un state vide.
- **Voice connection drop** : listener `VoiceConnectionStatus.Disconnected`
  → si `humans > 0`, retry avec backoff exponentiel ; sinon attendre le
  prochain `voiceStateUpdate`.
- **yt-dlp lent** sur grosses playlists : on log la progression, on
  ack le message tout de suite.
- **Shutdown propre** : `SIGTERM`/`SIGINT` → flush le store, disconnect
  voice, `client.destroy()`.

---

## Layout final proposé

```
jukebot/
├── package.json
├── tsconfig.json
├── .env.example
├── Dockerfile               # multi-stage build
├── docker-compose.yml
├── .dockerignore
├── README.md
├── SETUP.md
├── CLAUDE.md
├── PLAN.md
├── data/                    # gitignored, runtime, monté en volume
│   └── state.json
└── src/
    ├── main.ts              # bootstrap
    ├── config.ts            # env loading + zod validation
    ├── logger.ts            # pino instance
    ├── discord/
    │   ├── client.ts        # client + ready handler
    │   ├── commands.ts      # /list, /reset-playlist
    │   └── voicePresence.ts # voiceStateUpdate
    ├── youtube/
    │   ├── urlMatcher.ts
    │   └── ytdlp.ts
    ├── playlist/
    │   ├── types.ts
    │   ├── timeline.ts      # pure clock math (tested)
    │   ├── store.ts         # state mutations + persistence
    │   ├── ingest.ts        # live messageCreate
    │   └── backfill.ts      # historical scan + reset
    ├── audio/
    │   ├── voice.ts         # voice connection lifecycle
    │   ├── player.ts        # AudioPlayer + track playback
    │   └── ffmpeg.ts        # ffmpeg subprocess (with seek)
    ├── format/
    │   └── list.ts          # /list ANSI rendering
    └── util/
        ├── prerequisites.ts # yt-dlp / ffmpeg version checks
        └── atomicWrite.ts   # write-temp-rename
```

## Dépendances système

**Mode Docker (canonique)** : seul `docker` + `docker compose` requis sur
l'hôte. Tout le reste (Node, ffmpeg, yt-dlp, Python3) est dans l'image —
voir D15 dans `CLAUDE.md`.

**Mode local (dev seulement)** :
- `node` ≥ 20
- `ffmpeg` (n'importe quelle version récente)
- `yt-dlp` (à jour — `pip install -U yt-dlp` ou via `pipx`)

## Tests

MVP : on vise des tests unitaires uniquement sur `playlist/timeline.ts`
(la math est non-triviale et les bugs sont silencieux). Le reste est testé
manuellement à mesure des phases. Frameworks : `node:test` + `tsx`,
zéro dépendance.

## Ordre d'exécution recommandé

Phases 0-3 sont prérequis durs. Ensuite :

- 4 (queue + clock) **avant** 5 (audio), parce que le player consomme la
  state.
- 6 dépend de 4 + 5.
- 7 (presence) et 8 (ingest) sont indépendants entre eux et peuvent
  s'écrire dans n'importe quel ordre après 6.
- 9 (backfill / reset) après 8 parce qu'il réutilise
  `extractTracksFromMessage`.
- 10 (`/list`) peut s'écrire à n'importe quel moment après 4 (besoin de
  state lisible) — utile **tôt** pour debugger les phases suivantes.
- 11 (robustesse) en parallèle des autres, ou en passe finale.

## Estimation très grossière

- Phases 0-3 : ~1 session courte (scaffolding + connexion).
- Phases 4-6 : la viande du projet, ~2-3 sessions (la timeline math + la
  pipeline audio avec seek peuvent être pénibles à debugger).
- Phases 7-10 : ~1-2 sessions chacune si rien ne dérape.
- Phase 11 : à mesure des bugs rencontrés.

Total réaliste : 6-8 sessions de codage productives, sachant que 80% du
risque est sur **Phase 5/6** (compatibilité ffmpeg seek + stabilité du
flux yt-dlp en pipe).

## Risques identifiés

1. **yt-dlp + ffmpeg seek imprécis sur certains formats Opus/WebM**.
   Mitigation : tester tôt en Phase 5, fallback possible sur seek sans
   `-ss` (lire depuis le début et drop les premières N secondes) si
   nécessaire — ça consomme bande passante mais c'est simple.
2. **Rate-limit YouTube** sur l'expansion de grosses playlists.
   Mitigation : concurrence ≤ 4, retry sur erreur réseau, log clair.
3. **Discord voice gateway flaky** sur connexions instables.
   Mitigation : Phase 11, reconnect avec backoff.
4. **Persistance de `state.json` qui devient gros** si la queue grandit
   sur des mois. Mitigation : pas avant un million de tracks, on s'en
   fout pour le MVP.

## Hors scope (volontairement)

- Multi-serveur / multi-guild.
- Sources non-YouTube (Spotify, SoundCloud, etc.).
- Volume / égaliseur / effets.
- Web UI ou dashboard.
- Authentification / rôles Discord pour limiter `/reset-playlist`.
- Historique des morceaux joués / stats.

À ajouter au backlog si l'usage le justifie.
