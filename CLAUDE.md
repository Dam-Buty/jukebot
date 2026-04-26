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

## D4 — Modèle de queue : in-memory + dump JSON optionnel

**Décision.** Queue représentée par un simple `Track[]` en mémoire. Au
shutdown propre, dump dans `data/queue.json`. Au démarrage, reload si présent.

**Raison.**
- MVP, un seul serveur, pas de besoin de SQLite/Postgres.
- La queue est éphémère par nature : si le bot crashe, c'est OK de perdre les
  morceaux pas encore joués (l'utilisateur peut re-poster).
- Facile à upgrader plus tard si on veut historique / stats.

**Conséquences.**
- Pas de DB. `data/` est gitignoré.
- Une seule queue globale partagée par le serveur (pas de queue par user).

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
- À décider plus tard (D7+) : si une playlist est postée, on l'expand en N
  tracks ou on la stocke comme une seule entrée ? *Ouvert.*

---

## D6 — Channel vocal : "follow the caller" par défaut

**Décision.** Pas de channel vocal fixé en config. À la commande `/play`, le
bot rejoint le channel vocal de la personne qui invoque la commande. Si
l'utilisateur n'est pas en vocal, erreur explicite.

**Raison.**
- Plus naturel pour l'usage entre potes : tu cliques play depuis le vocal où
  tu es déjà.
- Évite le cas pénible "le bot est dans le mauvais channel".
- `VOICE_CHANNEL_ID` reste optionnel comme override.

**Conséquences.**
- Permission `Connect` + `Speak` requises sur tous les channels vocaux où on
  pourrait vouloir jouer. À documenter dans `SETUP.md`.

---

## Décisions ouvertes (à trancher avec l'utilisateur)

- **D7 — Slash commands minimales.** Liste pressentie : `/play [url?]`,
  `/skip`, `/pause`, `/resume`, `/queue`, `/clear`, `/leave`. À valider.
- **D8 — Comportement sur playlist YouTube postée** (cf. D5).
- **D9 — Auto-leave** quand la queue est vide / le vocal est vide depuis X
  minutes ?
- **D10 — Logs / observabilité.** `pino` + console suffit pour un MVP, ou on
  veut un fichier rotatif ?
