# Giveaway

Local second-hand marketplace. The MVP is free giveaways only.

## Run

```bash
npm install
npx playwright install chromium   # once, for the walkthrough test
npm run dev
```

Open http://localhost:5173 on a phone or in a mobile viewport.

## API keys

The Claude key is read only by the Node server, never by the frontend. Put it
in a gitignored file next to the server:

- `server/.env.development` - dev key, used by `npm run dev` (default).
- `server/.env.production` - prod key, used when `NODE_ENV=production`.

Each file is one line: `ANTHROPIC_API_KEY=sk-ant-...`. A key already exported in
the shell wins over the file. Without any key the app still runs, but the AI
draft step returns an empty form with a notice and you fill in the listing
yourself.

## Layout

- `src/` - Vite frontend, plain JS, hash-routed. Listings live in `localStorage`.
- `server/index.js` - Express API on port 3001. Holds the Claude key and
  serves `POST /api/draft` (photos in, structured listing draft out) and
  `GET /api/health`. Vite proxies `/api` to it.
- `tests/phase1.mjs` - Playwright walkthrough of photo -> draft -> edit -> post.
  Run with `npm test` while the dev servers are up.

## Listing shape

`price: null` means free; the MVP never sets a price. `status` is one of
`listed`, `requested`, `accepted`, `completed`, `cancelled`. Later phases
(claims, pickup slots, accounts, reminders) hang off these two fields.

The AI draft also returns `isPhotoOfItem`. When false (drawing, screenshot,
catalog image) the edit step shows a retake prompt. The server logs one JSON
line per draft (no image data) so real-phone tests can be reviewed.
