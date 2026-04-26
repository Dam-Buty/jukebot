# SETUP — côté Discord

Ce que **toi** tu dois faire dans le portail Discord et sur ton serveur avant
qu'on puisse faire tourner le bot. Étapes manuelles uniquement — toute la
partie code/config locale est dans le `README.md`.

## 1. Créer l'application Discord

1. Va sur <https://discord.com/developers/applications>.
2. Clique sur **New Application**, donne-lui un nom (ex. `jukebot`).
3. Dans **General Information**, note l'**Application ID** (= Client ID).

## 2. Créer le bot user

1. Onglet **Bot** dans la sidebar.
2. Clique **Add Bot** / **Reset Token** → **récupère le token** et garde-le
   précieusement (il ne sera affiché qu'une fois). Il ira dans `.env` sous
   `DISCORD_TOKEN`.
3. Décoche **Public Bot** si tu veux que seul toi puisses l'inviter.

## 3. Activer les Privileged Intents

Toujours dans l'onglet **Bot**, descends à **Privileged Gateway Intents** et
**active** :

- **MESSAGE CONTENT INTENT** ← *obligatoire*, sans ça le bot ne peut pas lire
  le contenu des messages pour y détecter les URLs YouTube.
- *(optionnel)* **SERVER MEMBERS INTENT** — pas nécessaire pour le MVP.

> Pour des bots dans plus de 100 serveurs, Discord exige une vérification
> manuelle pour ces intents. Tant que tu restes en privé sur un seul serveur,
> tu peux juste les cocher et c'est bon.

## 4. Permissions du bot

Onglet **OAuth2 → URL Generator** :

- **Scopes** : coche `bot` et `applications.commands`.
- **Bot Permissions** : coche au minimum
  - `View Channels`
  - `Send Messages`
  - `Read Message History`
  - `Use Slash Commands`
  - `Connect` (rejoindre un channel vocal)
  - `Speak` (parler dans un channel vocal)
  - *(optionnel)* `Embed Links`, `Add Reactions`

Copie l'URL générée en bas de page → ouvre-la dans le navigateur → invite le
bot sur ton serveur.

## 5. Préparer le serveur

1. Crée (ou choisis) un **channel texte** qui servira de "playlist". C'est là
   où tu colleras les liens YouTube. Note son **ID** (Discord en mode dev :
   clic droit sur le channel → *Copy Channel ID*).
2. Crée (ou choisis) un **channel vocal** où le bot vivra en permanence. Le
   bot ne change pas de channel — il s'y connecte au démarrage et y diffuse
   sa "radio". Note son ID.
3. Active le mode développeur si nécessaire : *User Settings → Advanced →
   Developer Mode*.

## 6. Activer Discord Developer Mode (si pas déjà fait)

Pour pouvoir copier les IDs facilement :

- *User Settings → Advanced → Developer Mode → ON*

## 7. Récap des valeurs à me donner / mettre dans `.env`

À la fin de cette procédure tu dois avoir en main :

| Variable               | Source                                            |
| ---------------------- | ------------------------------------------------- |
| `DISCORD_TOKEN`        | onglet Bot → Reset Token                          |
| `DISCORD_CLIENT_ID`    | onglet General Information → Application ID      |
| `DISCORD_GUILD_ID`     | clic droit sur ton serveur → Copy Server ID       |
| `PLAYLIST_CHANNEL_ID`  | clic droit sur le channel texte "playlist"        |
| `VOICE_CHANNEL_ID`     | clic droit sur le channel vocal "domicile" du bot |

Une fois ces 5 valeurs récupérées, on peut passer à l'implémentation.
