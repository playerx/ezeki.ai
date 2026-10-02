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

## Claiming (Phase 2)

There are no accounts yet, so a **Giving / Finding** switch in the header
lets one phone play both sides. Finders see open listings, pick a concrete
pickup window from the giver's availability over the next week, leave a
one-line message, and confirm. First come, first served: the first claim is
accepted automatically and the finder sees the address and notes; later
claims queue as a waitlist and are promoted automatically if the giver or the
finder cancels, or on a no-show. After the window passes both sides get a
"did it happen?" check-in: a yes from either side closes the listing, a no
records a no-show against the other side and reopens it for the next in
line. With no answer for a day the claim lapses the same way. Reminders are
in-app banners on home ("pickup today", "check in").

For tests, `localStorage['giveaway.clock']` pins "now".

## Layout

- `src/` - Vite frontend, plain JS, hash-routed. Listings live in `localStorage`.
  `main.js` routes and renders home and listing pages, `flow.js` is the
  post/edit flow, `claims.js` is the claim loop as pure functions, `map.js`
  wraps Leaflet and the geocoder, `util.js` holds shared helpers.
- `server/index.js` - Express API on port 3001. Holds the Claude key and
  serves `POST /api/draft` (photos in, structured listing draft out),
  `GET /api/geocode` (area lookup) and `GET /api/health`. Vite proxies `/api` to it.
- `tests/phase1.mjs` - Playwright walkthrough of posting, editing, resume.
  `tests/phase2.mjs` - the claim loop. Run both with `npm test` while the dev
  servers are up.

## Listing shape

Posting is four steps: photos, check the details, pickup, review. Progress is
saved in the browser as you go, so a refresh or a detour to another screen
resumes where you left off (home shows a resume banner). Listings can be
edited or removed from their page; with no accounts yet, every listing in a
browser belongs to that giver. The pickup step
asks for a public area, a private street address, availability windows (day
by morning, afternoon, evening) and notes. Area, address and availability are
remembered as giver defaults for the next listing.

`pickup` is `{ area, address, availability, notes }`. `address` is never shown
on the listing; it will be revealed to a recipient once a pickup is confirmed.
`availability` is a list of slots like `mon-eve` or `sat-am`. `location` is
the geocoded centroid of the area (`{ lat, lon, label }`), set when the giver
picks a suggestion; only the public area is ever geocoded, never the address.
Maps are Leaflet with OpenStreetMap tiles and draw a wide circle around that
centroid. Area lookup goes through `GET /api/geocode`, which proxies and
caches Nominatim and biases results to the browser's locale country. Before
real traffic, switch tiles and geocoding to a provider with a usage agreement.

`price: null` means free; the MVP never sets a price. `status` is one of
`listed`, `claimed`, `completed`, `cancelled`. `requests` holds every claim
(`{ id, meId, name, message, when: { date, part }, status, ... }`) with status
`accepted`, `waiting`, `cancelled`, `completed` or `no_show`. Later phases
(claims, pickup slots, accounts, reminders) hang off these two fields.

The AI draft also returns `isPhotoOfItem`. When false (drawing, screenshot,
catalog image) the edit step shows a retake prompt. The server logs one JSON
line per draft (no image data) so real-phone tests can be reviewed.
