# jukebot

Discord bot qui streame l'audio de vidéos YouTube dans un channel vocal,
en construisant automatiquement sa playlist à partir des liens YouTube postés
dans un channel texte donné.

## Idée

- Un channel texte désigné = **playlist** : tout lien YouTube qui y est
  posté est ajouté à la queue.
- Un channel vocal désigné = **scène** : le bot y vit en permanence.
- Le bot fonctionne comme une **radio FM** : une horloge virtuelle avance en
  continu, on transmet quand il y a des auditeurs et on coupe quand le
  vocal est vide — mais la timeline ne s'arrête jamais. Si tu rejoins en
  cours de track, tu tombes au milieu, comme dans une vraie radio.
- La queue est un **anneau infini** : quand on atteint le dernier track,
  on revient au premier. Pas de fin.
- **❌ veto** : ajouter une réaction ❌ sur un message du channel playlist
  retire le track concerné de l'ingestion live, du backfill et de
  `/reset-playlist`. Si yt-dlp échoue à résoudre une URL, le bot pose
  lui-même un ❌ — tu peux le laisser pour vétoer définitivement, ou
  l'enlever pour retenter au prochain `/reset-playlist`.
- Slash commands :
  - `/list` — affiche la queue + position courante en code block ANSI,
    avec auteur et "added X ago" par track.
  - `/reset-playlist` — vide la queue et la rebuild en rescannant
    l'historique du channel playlist.

## Stack

- **TypeScript** (Node ≥ 20, ESM strict).
- **discord.js v14** + **@discordjs/voice** (≥ 0.19) pour le bot et la voix.
- **yt-dlp** + **ffmpeg** packagés dans une image Docker — pas de
  dépendance bare-metal côté hôte en mode canonique.
- État persisté dans `data/state.json` (queue + horloge virtuelle +
  curseur de backfill), écriture atomique via `src/util/atomicWrite.ts`.

Voir [`CLAUDE.md`](./CLAUDE.md) pour les décisions de design,
[`PLAN.md`](./PLAN.md) pour l'historique d'implémentation et le mapping
modules → décisions.

## Setup (recommandé : Docker)

Pré-requis hôte : `docker` + `docker compose`. C'est tout. Ni Node, ni
ffmpeg, ni yt-dlp côté hôte.

1. Suivre [`SETUP.md`](./SETUP.md) pour créer l'application Discord, récupérer
   le token, configurer les intents, inviter le bot sur ton serveur, et
   noter les 5 IDs nécessaires.
2. `cp .env.example .env` puis remplir les valeurs.
3. `npm run run:docker` (alias de `docker compose up --build`, foreground).
   Ajouter `-d` à la commande compose si tu veux détacher.
4. Pour mettre à jour yt-dlp (en cas de breakage YouTube) :
   `docker compose build --no-cache && npm run run:docker`. Le `Dockerfile`
   re-télécharge le zipapp officiel depuis le dernier release GitHub à
   chaque rebuild non cache.

L'état (queue + horloge virtuelle + `lastSeenMessageId`) persiste dans
`./data/state.json` via volume bind — il survit aux restarts et au
`docker compose down`.

## Setup local (sans Docker, pour le dev)

Si tu hackes sur le code et tu veux un cycle plus court :

1. Avoir Node ≥ 20, `ffmpeg`, `yt-dlp` (à jour : `pip install -U yt-dlp`
   ou via `pipx`) installés sur ta machine.
2. `cp .env.example .env` puis remplir.
3. `npm install`
4. Au choix :
   - `npm run dev` — rechargement à chaud via `tsx watch` (idéal pendant le
     code).
   - `npm run run:bare` — `npm run build` puis lance la version compilée
     avec `--env-file=.env` (équivalent local de `run:docker`).
5. `npm test` lance les tests (`tsx --test`) — couvre la math de la
   timeline, le store, le matcher d'URL, le rendu `/list` et la logique
   de réaction ❌.

## Comportement à connaître

- **Backfill au boot.** Le bot scanne l'historique du channel playlist
  pour rattraper tout ce qui a été posté pendant qu'il était down. Le scan
  tourne en tâche de fond — le bot est online (commandes, voix, ingest
  live) pendant ce temps. Le curseur `lastSeenMessageId` est persisté
  page par page : un kill mid-scan reprend pile où il s'était arrêté.
- **Streaming par page.** Chaque page de 100 messages traitée pousse ses
  tracks dans la queue avant que le scan suivant démarre — la radio peut
  démarrer avant la fin du backfill.
- **Track illisible.** Si yt-dlp ou ffmpeg pète sur un track (vidéo
  retirée, age-gated, region-locked), le bot **retire** le track de la
  queue (pas juste un skip), pour ne pas reboucler dessus à chaque tour.
  Re-poste le lien si c'était un glitch transitoire.
- **Pas de dédup.** Poster la même URL N fois → elle apparaît N fois dans
  la queue. C'est volontaire : ça permet de pondérer un morceau à la main.
- **Mix YouTube auto-générés ignorés.** Une URL avec `&list=RD…` ou
  `&start_radio=1` (= mix YouTube infini) est traitée comme la **vidéo
  seule**, pas comme une playlist. Seules les playlists `PL…` / `OL…`
  (vraies playlists user-curated) sont expansées.

## Troubleshooting

- **`ERROR: ... HTTP Error 429`** dans les logs yt-dlp. Le bot retry une
  fois après 5 s ; au-delà tu prends un cooldown YouTube. La
  configuration utilise déjà `--extractor-args
  "youtube:player_client=android,web"` pour éviter le souci de Visitor
  Data PO token sur le client web depuis fin 2024. Si ça persiste : sors
  de Docker, attends, ou rebuild avec `--no-cache` pour récupérer un
  yt-dlp plus frais.
- **`MESSAGE CONTENT INTENT` non activée.** Le bot tourne mais aucun lien
  posté n'est détecté. Va dans le portail Discord → onglet Bot →
  Privileged Gateway Intents → coche **MESSAGE CONTENT INTENT**. Voir
  `SETUP.md`.
- **Le bot rejoint le vocal mais ne joue rien.** Vérifie qu'au moins un
  humain est dans le channel vocal — le bot pause la transmission quand
  il est seul (`src/discord/voicePresence.ts`), mais l'horloge continue.
- **`voice connection failed to become ready`.** Tu as probablement un
  `@discordjs/voice` < 0.18 quelque part dans un fork. Discord a changé
  son protocole vocal fin 2024 ; il faut au minimum la 0.18, idéalement
  la version pinée dans `package.json` (≥ 0.19.2).
- **`state.json` corrompu** au boot. Le bot l'archive en
  `state.json.broken-<timestamp>` et repart d'un state vide. Tu peux le
  recharger ensuite avec `/reset-playlist`.
- **Dépendances natives** au build (`@discordjs/opus`, `libsodium-wrappers`)
  qui pètent en local sans Docker. Sur Linux : installer
  `build-essential python3`. Sur Mac : installer Xcode CLT. Ou bien
  utiliser le mode Docker — c'est exactement pour ça qu'il existe.

## Layout du repo

```
jukebot/
├── src/
│   ├── main.ts              # bootstrap + wiring
│   ├── config.ts            # env loading + zod validation
│   ├── logger.ts            # pino (pretty en dev, JSON en prod)
│   ├── discord/
│   │   ├── client.ts        # client + ready handler
│   │   ├── commands.ts      # /list, /reset-playlist
│   │   └── voicePresence.ts # voiceStateUpdate → pause/disconnect
│   ├── youtube/
│   │   ├── urlMatcher.ts    # détection URLs + tri playlist/track
│   │   └── ytdlp.ts         # subprocess yt-dlp (metadata)
│   ├── playlist/
│   │   ├── types.ts         # Track, State
│   │   ├── timeline.ts      # math horloge virtuelle (testée)
│   │   ├── store.ts         # state + persistence atomique
│   │   ├── ingest.ts        # messageCreate → tracks
│   │   ├── backfill.ts      # scan historique + reset
│   │   └── reactions.ts     # détection veto ❌
│   ├── audio/
│   │   ├── voice.ts         # VoiceConnection lifecycle
│   │   ├── ffmpeg.ts        # subprocess ffmpeg + seek
│   │   ├── player.ts        # AudioPlayer + events
│   │   └── playback.ts      # orchestration timeline ↔ player
│   ├── format/
│   │   └── list.ts          # rendu ANSI de /list
│   └── util/
│       ├── prerequisites.ts # check yt-dlp / ffmpeg au boot
│       └── atomicWrite.ts   # write-temp + rename
├── data/                    # gitignored, monté en volume Docker
│   └── state.json
├── Dockerfile               # multi-stage Debian slim
├── docker-compose.yml
├── .env.example
├── README.md / SETUP.md / CLAUDE.md / PLAN.md
└── package.json / tsconfig.json
```
