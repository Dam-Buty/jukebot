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
