# Vinted Monitoring Discord Bot

A Discord bot that monitors Vinted listings and posts new items to Discord channels, with optional profit estimation and description extraction.

## Features

- Monitors Vinted catalogue URLs (per public/private Discord channel).
- Posts new listings with embeds, photos, and Vinted action buttons.
- Optional profit badge based on comparable listings.
- Optional description extraction for keyword filtering.
- Multi-language locale files (en-GB, es-ES, fr, it).
- Proxy support (Webshare or local `proxies.txt`).

## Requirements

- Node.js 20+ (tested with Node 24)
- MongoDB
- Playwright browsers (`npx playwright install`)
- A Discord bot token with the `Message Content` privileged intent enabled

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment template:
   ```bash
   cp .env.example .env
   ```
3. Edit `.env` with your Discord token, MongoDB URI, and settings.
4. (Optional) Add proxies to `proxies.txt` (one per line) if not using Webshare.

## Run locally

```bash
npm start
```

## Run with Docker

```bash
docker compose up -d
```

MongoDB data is stored in the `mongodb_data_container` volume.

## Tests

```bash
npm test
```

## Configuration

See `.env.example` for all available environment variables. Common ones:

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_ADMIN_ID`
- `MONGODB_URI`
- `VINTED_API_DOMAIN_EXTENSION` (e.g. `fr`, `co.uk`)
- `PROFIT_*` for profit estimation tuning
- `DESCRIPTION_*` for description extraction tuning
- `HEALTH_PORT` (optional) enables a `/health` endpoint

## Notes

- `.env`, `proxies.txt`, `app.log`, and `node_modules` are ignored by Git.
- Rotate Discord tokens if they are ever committed accidentally.
