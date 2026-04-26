# CLAUDE.md — Décisions de design

Document vivant. À mettre à jour à chaque décision structurante. Une décision
= un bloc avec **Contexte / Décision / Raison / Conséquences**.

## Contexte général

Bot Discord qui :
1. Surveille un channel texte désigné, en extrait les URLs YouTube postées
   et les enfile dans une queue.
2. Joue la queue dans un channel vocal, à la suite, en streamant l'audio.
3. Expose des slash commands pour contrôler la lecture.

Utilisateur cible : un seul serveur Discord privé entre potes. Pas de
multi-tenant, pas de scaling à prévoir.

> **Statut implémentation.** D1 → D19 sont implémentées dans `src/`. Le
> MVP a shippé. Voir `PLAN.md` pour le mapping décision → modules.
> Décisions ajoutées en cours d'implémentation par rapport au plan
> initial : D16 (track illisible = retrait définitif de la queue), D17
> (veto par réaction ❌), D18 (`addedBy` + `addedAt` dérivé de
> `message.createdAt`), D19 (cascade `player_client=android,web` côté
> yt-dlp).

---

## D1 — Langage & runtime : TypeScript sur Node 20+

**Décision.** TypeScript strict, Node ≥ 20, ESM.

**Raison.**
- Demande explicite de l'utilisateur.
- L'écosystème Discord (discord.js, @discordjs/voice) est natif Node, plus
  mature que les alternatives Python ou Go pour la voix.
- Node 20 = LTS courant, support natif `fetch`, `--env-file`, etc.

**Conséquences.**
- `tsx` ou `ts-node` pour le dev, `tsc` pour le build.
- `package.json` avec `"type": "module"`.

---

## D2 — Librairie Discord : discord.js v14 + @discordjs/voice

**Décision.** `discord.js` v14 pour le client / gateway / slash commands,
`@discordjs/voice` pour la connexion vocale et la pipeline audio.

**Raison.**
- Standard de facto en TS. Doc abondante, types first-class.
- `@discordjs/voice` est officiellement maintenu et expose la pipeline Opus
  proprement (player, resource, subscription).
- Alternatives écartées : `eris` (moins de typings), `oceanic.js` (plus jeune,
  plus petite communauté).

**Conséquences.**
- Dépendances natives requises : `@discordjs/opus` ou `opusscript`,
  `libsodium-wrappers` ou `sodium-native` pour le chiffrement voice gateway.
- Privilégier `@discordjs/opus` (perf) avec fallback `opusscript`.

---

## D3 — Extraction audio YouTube : yt-dlp via child process

**Décision.** On appelle le binaire `yt-dlp` en subprocess (`spawn`) et on
pipe son stdout dans `ffmpeg` → `@discordjs/voice` resource.

**Raison.**
- `ytdl-core` (npm) est notoirement fragile : YouTube casse les signatures
  régulièrement, le repo upstream est semi-abandonné. `@distube/ytdl-core`
  est mieux mais reste un patch perpétuel.
- `yt-dlp` est l'outil de référence, mis à jour très fréquemment, gère les
  changements YouTube en quelques heures. Trade-off acceptable : c'est une
  dépendance système au lieu d'un package npm.
- `play-dl` est une alternative pure-JS correcte, on garde ça en plan B si
  l'overhead du subprocess pose problème.

**Conséquences.**
- L'utilisateur doit avoir `yt-dlp` et `ffmpeg` installés. Documenté dans
  `README.md` et `SETUP.md`.
- Ajouter un check au démarrage : `yt-dlp --version` et `ffmpeg -version`,
  refuser de démarrer si absents.
- Pas besoin de `ytdl-core` dans `package.json`.

---

## D4 — État (queue + horloge) : in-memory avec snapshot JSON synchrone

**Décision.** L'état complet `{ startedAt, queue: Track[] }` vit en mémoire,
mais on **snapshot dans `data/state.json`** à chaque mutation (track ajouté,
track terminé, redémarrage de timeline). Au boot, on reload si présent.

**Raison.**
- Cf. D7 — l'horloge virtuelle doit survivre aux redémarrages, sinon on
  perd la position.
- Reste simple : un seul fichier JSON, écriture atomique (write-temp +
  rename). Pas besoin de SQLite pour ça.

**Conséquences.**
- `data/` gitignoré.
- Module `state/persistence.ts` isolé pour pouvoir migrer vers SQLite si on
  scale plus tard sans toucher au reste.
- Une seule queue globale par serveur (pas de queue par user).

---

## D5 — Source des morceaux : channel texte désigné, pas DM ni mention

**Décision.** Le bot écoute *uniquement* les messages postés dans le channel
configuré via `PLAYLIST_CHANNEL_ID`. Toute URL YouTube détectée par regex est
ajoutée à la queue.

**Raison.**
- Spec utilisateur explicite : "à partir des vidéos postées sur un channel
  donné".
- Évite les ambiguïtés (ne pas avaler des liens YouTube postés dans
  #general).

**Conséquences.**
- Nécessite `MESSAGE CONTENT INTENT` (cf. `SETUP.md`).
- Regex à supporter : `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`,
  `music.youtube.com/watch?v=`, playlists `youtube.com/playlist?list=`.

---

## D6 — Channel vocal : fixé en config (le bot "vit" dedans)

**Décision.** Un channel vocal unique défini par `VOICE_CHANNEL_ID` (env). Le
bot s'y connecte au démarrage et y reste tant qu'il y a de l'activité.
Pas de "follow the caller" — le bot a un domicile fixe.

**Raison.**
- D7 (radio always-on) implique un endroit stable où le bot diffuse.
- L'utilisateur pose les liens dans `PLAYLIST_CHANNEL_ID` et écoute dans
  `VOICE_CHANNEL_ID` ; les humains s'adaptent à la machine, pas l'inverse.

**Conséquences.**
- `VOICE_CHANNEL_ID` devient **obligatoire** dans `.env`.
- Permission `Connect` + `Speak` requises sur ce channel uniquement.

---

## D7 — Modèle de lecture : "radio" avec horloge virtuelle continue

**Décision.** Le bot ne s'arrête jamais *logiquement*. Il maintient une
**horloge virtuelle** (timeline) qui avance en continu : à tout instant, on
sait quel track est censé jouer et à quel offset. Quand le vocal est vide,
le bot **arrête simplement de transmettre** mais l'horloge continue de
courir. Quand quelqu'un rejoint, le bot **reprend la diffusion à la position
exacte** où la timeline en est arrivée (seek dans le track courant, pas
depuis le début).

Pas de slash commands de contrôle (`play`, `pause`, `skip`, `resume`, etc.).
La playlist se construit uniquement via les liens postés dans le channel
texte. La seule commande exposée est `/list` (cf. D11).

**Raison.**
- Spec utilisateur : "le bot devrait être toujours en train de jouer […] la
  playlist doit quand même 'avancer' pendant ce temps".
- Métaphore radio FM : ça diffuse en permanence, on choisit juste si on
  écoute ou pas.

**Conséquences (importantes).**
- Il faut connaître la **durée** de chaque track *avant* qu'il atteigne la
  tête de lecture. yt-dlp expose ça dans le JSON metadata (`duration`).
- Pour les playlists YouTube, un `yt-dlp --flat-playlist --dump-json` ne
  donne pas toujours la durée → il faut un appel par entry (`--no-playlist
  --dump-json <url>`) pour récupérer la durée fiable. À paralléliser
  raisonnablement (rate limit côté YouTube).
- Reprendre au milieu d'un track = `ffmpeg -ss <offset>` sur le flux yt-dlp.
  À tester : sur certains formats containers, le seek est imprécis. Si
  problème, fallback `-ss` *avant* `-i` (côté ffmpeg input) avec yt-dlp qui
  donne déjà l'URL directe.
- L'état de l'horloge = `{ startedAt: Date, queue: Track[] }`. La position
  courante se calcule : `elapsed = now - startedAt`, puis on décrémente par
  les durations des tracks pour trouver `(currentIndex, offsetInTrack)`.
- **Persistance nécessaire** : si le bot crashe ou redémarre, on perd la
  timeline. Donc on dump `{ startedAt, queue }` dans `data/state.json` à
  chaque modif (ajout track, fin de track) — ce qui revient sur la D4 (la
  queue n'est plus *purement* éphémère).
- Si un track échoue (vidéo retirée, age-gated, etc.) : voir D16 — on
  retire le track de la queue plutôt que de le sauter à chaque tour.

---

## D8 — Playlists YouTube : expand en N tracks

**Décision.** Quand un lien `youtube.com/playlist?list=…` (ou `watch?v=X&list=Y`)
est posté, on l'expand : on récupère toutes les entries via yt-dlp et on les
push une par une dans la queue, dans l'ordre de la playlist.

**Raison.**
- Cohérent avec D7 (chaque entry doit avoir sa duration dans la timeline).
- Permet à l'utilisateur de voir le détail dans `/list`.

**Conséquences.**
- L'expansion d'une grosse playlist peut prendre quelques secondes
  (multiples appels yt-dlp). On le fait async, on ack le post avec une
  reaction et on push au fur et à mesure.
- Si une vidéo dans la playlist est privée/supprimée : on la skip à
  l'expansion, on log.

---

## D9 — Pause auto sur vocal vide + déconnexion après inactivité longue

**Décision.** Deux niveaux :
1. **Pause de transmission immédiate** dès que le voice channel n'a plus
   d'humain (event `voiceStateUpdate`). L'horloge virtuelle continue.
2. **Déconnexion vocale** après `IDLE_DISCONNECT_MINUTES` (default `15`) sans
   personne dans le vocal. Reconnexion automatique dès qu'un humain rejoint.
   L'horloge continue dans tous les cas.

Si la queue est vide *et* personne n'est là : pareil, on attend. Quand un
nouveau lien est posté, on (re)démarre la timeline à `now`.

**Raison.**
- Pas la peine de tenir une connexion vocale ouverte pendant des heures sans
  auditeur. Économise du CPU/réseau côté bot.
- L'utilisateur voulait le comportement "se relancer quand quelqu'un se
  connecte" — on l'a, juste avec une étape réseau invisible si l'absence a
  duré.

**Conséquences.**
- `IDLE_DISCONNECT_MINUTES` exposé dans `.env` avec default raisonnable.
- Listener `voiceStateUpdate` filtre les bots (un bot seul ≠ humain présent).

---

## D10 — Logs : `pino` avec pretty-print en dev

**Décision.** `pino` comme logger, `pino-pretty` activé uniquement quand
`NODE_ENV !== 'production'`. Sortie stdout, pas de fichier rotatif.

**Raison.**
- Léger, structuré (JSON en prod = grep / jq friendly), zero-config.
- Un seul utilisateur / serveur : pas besoin d'archive log.
- Si besoin un jour : `pino` se redirige trivialement vers un fichier ou un
  transport.

---

## D11 — Slash commands : `/list` et `/reset-playlist`

**Décision.** Deux slash commands exposées :

- **`/list`** — affiche la queue + position courante en code block ANSI.
- **`/reset-playlist`** — vide la queue mémoire et la reconstruit en
  rescannant tout l'historique du channel playlist. Utile quand
  l'utilisateur a supprimé des liens du channel et veut que la radio
  reflète le nouvel état. Cf. D14.

`/list` répond avec un **code block ANSI Discord** (` ```ansi `) montrant :
- En-tête ASCII / Unicode (titre + barre de séparation).
- Track en cours, avec barre de progression Unicode (`▰▰▰▰▱▱▱▱`) et
  timestamp `mm:ss / mm:ss`, plus une ligne "added by `<auteur>` ·
  `<X ago>`" (cf. D18).
- Les N suivants (par défaut 10) avec leur position dans la queue, durée,
  et auteur tronqué.
- Couleurs ANSI sobres : un accent sur le track courant, gris pour le
  reste.
- Implémenté dans `src/format/list.ts`, output borné à ~1900 chars
  (down-sampling progressif de la liste up-next pour rester sous la
  limite Discord 2000).

Mock visuel cible :

```ansi
╔═══════════════════════════════════════════════════╗
║          ♪  JUKEBOT  ─  NOW STREAMING  ♪          ║
╚═══════════════════════════════════════════════════╝

▶  04 / 12
   Daft Punk — Around the World
   ▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱   3:42 / 7:08

UP NEXT
   05  Justice — D.A.N.C.E.                4:02
   06  LCD Soundsystem — All My Friends    7:37
   07  …
```

**Raison.**
- Demande utilisateur explicite (`/list` + bonus ASCII / ANSI / Unicode).
- Le code block ANSI Discord (` ```ansi … ``` `) supporte un sous-ensemble
  de SGR (couleurs, gras), c'est le bon canal d'expression.

**Conséquences.**
- Limite Discord : 2000 chars par message → fenêtrage si la queue est très
  longue (afficher *current ± N*).
- On garde un module `format/list.ts` isolé : facile à itérer sans toucher
  à la pipeline audio.

---

## D12 — Queue épuisée : loop infini de la playlist

**Décision.** La queue n'est jamais "épuisée" — c'est un **anneau infini**.
Quand on atteint le dernier track, on revient au premier sans interruption,
et la timeline continue de courir. Quand un nouveau lien est posté pendant
qu'on est dans une boucle, il est **append à la fin** de l'anneau et sera
lu lors du prochain passage à cette position.

**Raison.**
- Spec utilisateur : "on loop toujours la playlist". Modèle radio FM sans
  fin, on n'attend pas l'auditeur ni la prochaine action.

**Conséquences.**
- Modèle d'état révisé : `{ tracks: Track[], currentIndex: number,
  trackStartedAt: ISOString }`. Quand `now - trackStartedAt >=
  tracks[currentIndex].duration`, on incrémente `currentIndex` modulo
  `tracks.length` et on avance `trackStartedAt += duration`.
- Si `tracks.length === 0` → état "silencieux" : on n'a rien à jouer, on
  attend le premier lien. À ce moment-là : `startedAt = now`, `currentIndex
  = 0`, on démarre.
- L'append d'un nouveau track ne perturbe pas la lecture en cours : il
  rentre dans la rotation au prochain tour. (Pas de mid-cycle injection,
  trop chiant à raisonner et invisible côté auditeur.)

---

## D13 — Pas de déduplication

**Décision.** Si la même URL YouTube est postée N fois dans le channel
playlist, elle apparaît N fois dans la queue. Aucun dédup, ni à l'ingestion
en temps réel, ni au backfill, ni au `/reset-playlist`.

**Raison.**
- Spec utilisateur explicite : "si il est posté X fois il est X fois dans
  la playlist".
- Permet de pondérer un morceau à la main en le postant plusieurs fois
  (genre "je veux que ce track sorte plus souvent dans la loop").

**Conséquences.**
- L'ordre des doublons suit l'ordre chronologique des posts dans le
  channel (donc cohérent entre live ingestion et backfill).

---

## D14 — Backfill au démarrage + `/reset-playlist`

**Décision.** Deux mécanismes de reconstruction de la queue depuis le
channel playlist :

1. **Backfill au démarrage.** Au boot, le bot scanne l'historique du
   channel `PLAYLIST_CHANNEL_ID` pour récupérer **tous** les liens YouTube
   jamais postés, dans l'ordre chronologique (oldest → newest), et les
   ingère dans la queue. La timeline démarre à `now` une fois le backfill
   terminé.

   - Sur les boots suivants : on stocke `lastSeenMessageId` dans
     `state.json` ; au boot on **fetch uniquement les messages plus récents**
     pour éviter de tout rescanner. La queue déjà persistée est reload telle
     quelle, et on append les nouveautés.
   - Première fois (pas de `state.json`) : full scan, page par page (Discord
     API limite à 100 messages par appel).

2. **`/reset-playlist`.** Slash command qui :
   - **vide** complètement la queue mémoire,
   - **rescanne tout l'historique** du channel playlist depuis le début,
   - **rebuild** la queue dans l'ordre chronologique,
   - **réinitialise** la timeline (`startedAt = now`, `currentIndex = 0`).

   Geste destructif explicite, idéal après que l'utilisateur a supprimé des
   messages du channel et veut que la radio reflète le nouvel état.

**Raison.**
- Spec utilisateur explicite ("oui on backfill au démarrage" + commande de
  reset).
- Le distingo backfill incrémental / reset full évite de tout rescanner à
  chaque restart sans pour autant condamner l'utilisateur à un état
  divergent du channel.

**Conséquences.**
- Permission `Read Message History` indispensable (déjà dans `SETUP.md`).
- Le full scan d'un channel volumineux peut prendre du temps : on stream
  l'expansion (post une reaction sur le message du `/reset-playlist` style
  ⏳ → ✅, ou on edit la réponse différée Discord).
- Pendant un `/reset-playlist`, on **coupe net** : `replaceAll(tracks)`
  remplace la queue, puis `restartFromCurrent()` (cf.
  `src/audio/playback.ts`) tue le ffmpeg en cours et redémarre sur le
  nouveau track 0. C'est moins surprenant pour l'utilisateur que
  d'attendre la fin du track en cours pour voir la nouvelle playlist
  prendre effet. (Décision implémentation contre la proposition initiale
  de swap atomique différé.)
- Le scan `/reset-playlist` **n'utilise pas** le streaming par page de la
  variante boot — il écrit l'intégralité du résultat en une fois via
  `replaceAll`. Sur un gros channel ça peut prendre quelques secondes,
  d'où le `interaction.deferReply()`.
- Le scan boot, lui, **stream** chaque page dans la queue et persiste
  `lastSeenMessageId` après chaque page, pour qu'un kill mid-scan
  reprenne pile où il en était (cf. `src/main.ts` et le callback `onPage`
  de `scanChannel`).

---

## D15 — Docker comme runtime canonique

**Décision.** Le bot tourne dans une image Docker auto-suffisante (Node 20 +
ffmpeg + yt-dlp + Python3). L'hôte n'a besoin que de Docker et Docker
Compose — plus aucune dépendance bare-metal côté machine d'exécution.
`docker compose up -d` est le geste de démarrage canonique. Tourner sans
Docker (`npm install` + `node`) reste possible pour le dev local, documenté
en deuxième position dans le `README`.

**Raison.**
- yt-dlp casse régulièrement quand YouTube change ses formats : un rebuild
  d'image = un yt-dlp frais, sans avoir à pip install à la main sur l'hôte.
- ffmpeg n'a pas la même version partout (Ubuntu LTS, Mac brew, Arch),
  l'image fige une version reproductible.
- Reproductibilité "ça marche chez moi" → vraie immutabilité.

**Conséquences.**
- Build **multi-stage** : `node:20-bookworm-slim` pour les deux stages.
  Debian (pas Alpine) parce que `@discordjs/opus` + libsodium sont moins
  galère avec glibc qu'avec musl + node-gyp.
- yt-dlp installé via le **zipapp officiel** depuis GitHub releases
  (architecture-agnostique, requiert juste `python3` runtime). Le fait que
  ce soit un zipapp Python plutôt qu'un binaire PyInstaller permet à
  l'image de tourner sur x86_64 et arm64 (utile si tu déploies sur RPi /
  Mac M-series).
- Image runtime tourne sous user non-root `jukebot`.
- `data/` monté en **volume bind** (`./data:/app/data`) → `state.json`
  persiste entre restarts du conteneur, comme prévu en D4.
- `.env` chargé via `env_file:` dans `docker-compose.yml`. Le `--env-file`
  Node natif n'est plus utile dans ce mode.
- Pas de port exposé : le bot est purement outbound (WebSocket Discord
  Gateway).
- `prerequisites.ts` (Phase 2 du PLAN) reste pertinent à l'intérieur du
  conteneur comme belt-and-suspenders, même si l'image *devrait* toujours
  les avoir — un check qui prend 50ms vaut mieux qu'un crash bizarre au
  premier track.

---

## D16 — Track illisible : retrait de la queue, pas un skip

**Décision.** Quand un track échoue (yt-dlp ne résout pas l'URL, ffmpeg
plante mid-stream, vidéo retirée / age-gated / region-locked), on
l'**enlève** complètement de la queue via `Store.removeTrackAt(index)`.
Pas de tag `unavailable`, pas de retry au prochain tour.

**Raison.**
- D7 / D12 prédisaient un skip avec timeline qui avance "comme si" le
  track avait joué. En pratique, sur une boucle infinie, ça veut dire
  qu'on retombe sur le track cassé à chaque tour et qu'on perd 5 s à
  retenter à chaque cycle.
- Si le user veut le re-tenter, il peut juste re-poster le lien — le live
  ingest le remettra dans la queue (ou bien `/reset-playlist` le
  recapturera, à moins qu'un ❌ n'ait été ajouté entretemps, cf. D17).

**Conséquences.**
- `Store.removeTrackAt` (`src/playlist/store.ts`) gère trois cas selon
  que le track retiré est avant, sur, ou après `currentIndex` ; quand
  c'est le track courant, on ré-ancre `trackStartedAt = now` pour que le
  nouveau track démarre à 0:00.
- L'orchestrateur (`src/audio/playback.ts`) capture les deux modes
  d'échec : (a) `playTrack` lève → on retire avant même que la lecture
  démarre ; (b) le player émet `track-finished` avec une `Error` →
  pareil.
- Backoff de 750 ms entre échecs successifs pour éviter de pin le CPU
  sur une queue 100 % cassée.

---

## D17 — Veto ❌ par réaction sur le message playlist

**Décision.** Une réaction ❌ sur un message du channel playlist marque
ce message comme **vetoé**. Tout pipeline de résolution (ingest live,
backfill incrémental, full scan via `/reset-playlist`) **skip**
silencieusement les messages vetoés via
`hasNegativeReaction(message.reactions.cache.values())`.

Le bot lui-même pose un ❌ quand toutes les URLs d'un message échouent à
résoudre côté yt-dlp. Le user peut :
- **laisser** le ❌ → le track ne reviendra plus jamais, même au prochain
  reset ;
- **retirer** le ❌ → au prochain `/reset-playlist`, le track sera
  retenté.

Et symétriquement, le user peut ajouter un ❌ à la main sur n'importe quel
message pour vétoer définitivement un track qui passe trop, sans devoir
supprimer le message Discord.

**Raison.**
- Effacer le message du channel marche aussi mais c'est destructif et
  perd le contexte de qui a posté quoi quand.
- Le ❌ est déjà l'emoji que le bot pose en cas d'échec — réutiliser le
  même signal pour les deux sens est cohérent et évite d'inventer un
  protocole de réactions parallèle.

**Conséquences.**
- Logique isolée dans `src/playlist/reactions.ts` (testée).
- `extractTracksFromMessage` (dans `src/playlist/ingest.ts`) est le seul
  point d'entrée d'ingestion : il check les réactions avant d'appeler
  yt-dlp. Backfill et live ingest passent tous les deux par lui.
- Les réactions ne sont pas toujours dans le cache au boot ;
  `messages.fetch` côté backfill les ramène, mais des réactions ajoutées
  pendant que le bot est down et avant que la page contenant le message
  soit re-fetchée pourraient ne pas apparaître. En pratique
  `/reset-playlist` règle le cas : il refait un scan complet.

---

## D18 — Métadonnées Track enrichies : `addedBy`, `addedAt = message createdAt`

**Décision.** Chaque `Track` porte :
- `addedBy: string` — display name (`globalName ?? username`) du humain
  qui a posté le lien.
- `addedAt: string` — ISO timestamp dérivé de `message.createdAt`, **pas**
  du moment où le bot a scanné le message.
- `addedByMessageId: string` — pour le veto ❌ (D17) et pour pouvoir
  remonter au message d'origine.

**Raison.**
- Le `/list` affiche "added by chad · 2d ago" — l'utilisateur veut savoir
  qui a posté quoi et quand.
- Utiliser `message.createdAt` au lieu de `now` au moment du scan rend
  `addedAt` **stable** entre un boot frais et un `/reset-playlist` :
  rescanner le channel produit exactement les mêmes timestamps.
- Cohérence de l'ordre : tracks ingérés en live et tracks récupérés au
  backfill sont triés au même endroit dans `/list`.

**Conséquences.**
- `addedBy` est marqué optionnel sur le `Track` pour rester compatible
  avec les `state.json` antérieurs à l'introduction du champ — on
  retombe sur "?" dans le rendu `/list` plutôt que de planter au boot.
- `relativeTime()` dans `src/format/list.ts` formate le delta : "just
  now" → "Xm ago" → "Xh ago" → "yesterday" → "Xd ago" → "Xmo ago" →
  "Xy ago".

---

## D19 — yt-dlp : cascade `player_client=android,web` + `bestaudio*/best`

**Décision.** Tous les appels yt-dlp (metadata `--dump-json` comme URL
résolution `-g`) passent les arguments :

```
--extractor-args "youtube:player_client=android,web"
-f bestaudio*/best
--no-playlist
```

Plus un retry unique avec backoff 5 s sur erreur HTTP 429.

**Raison.**
- Depuis fin 2024, le client `web` de YouTube exige un PO token /
  Visitor Data pour servir les flux audio. yt-dlp tombe en HTTP 429 +
  "Missing required Visitor Data" sans contournement.
- Le client `android` n'a pas ce souci. La cascade `android,web` essaie
  android d'abord, fallback web si jamais android est down.
- `bestaudio*/best` (avec wildcard) accepte autant les formats audio-only
  que les formats audio+video : certains clients YouTube n'exposent que
  des streams combinés, et de toute façon ffmpeg strippe la vidéo via
  `-vn` côté décodage.

**Conséquences.**
- Constantes partagées entre `src/youtube/ytdlp.ts` (metadata) et
  `src/audio/ffmpeg.ts` (URL résolution + stream Opus).
- À ré-évaluer si YouTube casse à nouveau la stratégie android — le
  ticket à surveiller est le repo upstream
  [`yt-dlp/yt-dlp`](https://github.com/yt-dlp/yt-dlp/issues).
- Un rebuild Docker `--no-cache` re-télécharge le yt-dlp officiel
  depuis GitHub releases ; en mode bare-metal il faut `pip install -U
  yt-dlp` à la main.

---

## Décisions ouvertes (à trancher)

*Aucune. Le MVP a shippé. Toute nouvelle décision structurante doit
arriver en D20+ sous la même structure (Contexte / Décision / Raison /
Conséquences) et être référencée depuis le code concerné.*
