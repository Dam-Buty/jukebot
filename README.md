# jukebot

Discord bot qui streame l'audio de vidéos YouTube dans un channel vocal,
en construisant automatiquement sa playlist à partir des liens YouTube postés
dans un channel texte donné.

## Idée

- On désigne un channel texte comme **"channel playlist"**.
- Tout lien YouTube qui y est posté est ajouté à la queue du bot.
- Le bot rejoint un channel vocal et joue la queue à la suite.
- Quelques slash commands pour contrôler la lecture (skip, pause, queue, etc.).

## Stack

- **TypeScript** (Node 20+)
- **discord.js v14** + **@discordjs/voice** pour le bot et la voix
- **yt-dlp** (binaire externe) pour extraire le flux audio YouTube
- **ffmpeg** (binaire externe) pour transcoder vers Opus

Voir [`CLAUDE.md`](./CLAUDE.md) pour les décisions de design détaillées.

## Setup

1. Suivre [`SETUP.md`](./SETUP.md) pour créer l'application Discord, récupérer
   le token, configurer les intents et inviter le bot sur ton serveur.
2. Installer les dépendances système : `ffmpeg`, `yt-dlp`, Node 20+.
3. `cp .env.example .env` puis remplir les valeurs.
4. `npm install`
5. `npm run dev`

## Status

WIP — squelette en cours de mise en place. L'implémentation arrive après
l'alignement sur les décisions de design.
