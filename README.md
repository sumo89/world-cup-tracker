# World Cup 2026 Predictions Tracker

A GitHub Pages-ready web app to:
- show World Cup 2026 fixtures and results
- manage a list of players (friends)
- record each player's match outcome prediction (Home / Draw / Away)
- compute a leaderboard of correct predictions

## Security model

No API key is used by browser code.

The frontend reads static JSON from `public/data/fixtures.json`.
A GitHub Actions workflow fetches live data from worldcup26.ir and commits updated JSON.

## Tech stack

- React + TypeScript + Vite
- LocalStorage for users and picks
- GitHub Actions for data refresh + Pages deploy

## Local development

1. Install dependencies:

```bash
npm install
```

2. Start dev server:

```bash
npm run dev
```

3. Optional: refresh fixture JSON locally:

```bash
npm run sync:data
```

## GitHub setup

1. Push this project to GitHub (default branch `main`).
2. Enable GitHub Pages with source: GitHub Actions.
3. Run workflow `Update World Cup Fixtures Data` once manually to populate data.

After that:
- `update-fixtures-data.yml` refreshes data every 30 minutes.
- `deploy-pages.yml` deploys on each push to `main`.

## Important files

- `src/App.tsx`: UI + predictions + leaderboard logic
- `scripts/fetch-world-cup-data.mjs`: server-side API fetch + JSON generation
- `.github/workflows/update-fixtures-data.yml`: scheduled data refresh workflow
- `.github/workflows/deploy-pages.yml`: GitHub Pages deployment workflow

## API scope used

Current implementation uses:
- `GET https://worldcup26.ir/get/games`
- `GET https://worldcup26.ir/get/stadiums`

You can extend this later with rounds, standings, or player stats endpoints.
