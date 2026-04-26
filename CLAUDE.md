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
- Si un track échoue (vidéo retirée, age-gated, etc.) : on log, on saute, on
  recale la timeline en considérant la durée annoncée comme "déjà écoulée"
  pour ne pas faire dériver le clock.

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

## D11 — Slash command unique : `/list` avec rendu ANSI dans un code block

**Décision.** Une seule slash command exposée : `/list`. Elle répond avec un
**code block ANSI Discord** (` ```ansi `) montrant :
- En-tête ASCII / Unicode (titre + barre de séparation).
- Track en cours, avec barre de progression Unicode (`▰▰▰▰▱▱▱▱`) et
  timestamp `mm:ss / mm:ss`.
- Les N suivants (par défaut 10) avec leur position dans la queue et durée.
- Couleurs ANSI sobres : un accent sur le track courant, gris pour le reste.

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

## Décisions ouvertes (à trancher)

- **D12 — Comportement quand la queue est totalement consommée.** Trois
  options : (a) timeline gelée, on attend qu'un nouveau lien soit posté ;
  (b) loop sur la queue passée ; (c) silence radio sans rien afficher.
  Mon préf : (a) — cohérent avec "playlist". À confirmer.
- **D13 — Stratégie de déduplication** : si la même URL est postée deux fois
  dans le channel, on la queue deux fois ou on dédup ? Je propose : pas de
  dédup (l'utilisateur peut vouloir mettre un morceau deux fois exprès).
- **D14 — Filtre temporel sur le channel playlist au démarrage.** Au boot,
  est-ce qu'on backfill les liens YouTube postés dans le channel pendant
  que le bot était down (ex. derniers 50 messages), ou seulement les
  nouveaux ? Je propose : seulement les nouveaux (sinon on rejoue tout
  l'historique au moindre restart).
