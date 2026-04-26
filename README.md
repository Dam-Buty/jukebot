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
- Une seule slash command : `/list` pour voir la queue + position courante,
  rendue en ANSI / Unicode dans un code block.

## Stack

- **TypeScript** (Node 20+)
- **discord.js v14** + **@discordjs/voice** pour le bot et la voix
- **yt-dlp** + **ffmpeg** packagés dans une image Docker — pas de
  dépendance bare-metal côté hôte.

Voir [`CLAUDE.md`](./CLAUDE.md) pour les décisions de design,
[`PLAN.md`](./PLAN.md) pour le plan d'implémentation.

## Setup (recommandé : Docker)

Pré-requis hôte : `docker` + `docker compose`. C'est tout.

1. Suivre [`SETUP.md`](./SETUP.md) pour créer l'application Discord, récupérer
   le token, configurer les intents, inviter le bot sur ton serveur, et
   noter les 5 IDs nécessaires.
2. `cp .env.example .env` puis remplir les valeurs.
3. `docker compose up -d --build`
4. `docker compose logs -f` pour suivre.
5. Pour mettre à jour yt-dlp (en cas de breakage YouTube) :
   `docker compose build --no-cache && docker compose up -d`.

L'état (queue + horloge virtuelle) persiste dans `./data/state.json` via
volume bind — survit aux restarts.

## Setup local (sans Docker, pour le dev)

Si tu hackes sur le code et tu veux un cycle plus court :

1. Avoir Node ≥ 20, `ffmpeg`, `yt-dlp` installés sur ta machine.
2. `cp .env.example .env` puis remplir.
3. `npm install`
4. `npm run dev` (rechargement à chaud via `tsx watch`).

## Status

WIP — design verrouillé, implémentation pas encore démarrée. Cf.
[`PLAN.md`](./PLAN.md) pour la séquence de phases.
