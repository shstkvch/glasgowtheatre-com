# Glasgow Theatre

**glasgowtheatre.com** — What's on in Glasgow's theatre scene.

## Adding Events

Edit `data/events.json`. Each event looks like:

```json
{
  "id": "unique-id",
  "title": "Show Title",
  "venue": "Citizens Theatre",
  "venueId": "citizens",
  "date": "2026-03-01",
  "time": "19:30",
  "endDate": "2026-03-15",
  "type": "professional",
  "tags": ["drama"],
  "description": "Short description.",
  "ticketUrl": "https://example.com",
  "image": null
}
```

**Types:** `professional`, `grassroots`, `new-writing`, `scratch`, `community`

**venueId** must match an `id` in `data/venues.json`.

## Build

```bash
node build.js
```

This generates `dist/index.html`, `dist/venues.html`, and `dist/about.html` from the JSON data, and copies CSS/JS assets to `dist/`.

## Deploy

Deployed via Netlify. Push to `main` to trigger a build. The build command and publish directory are configured in `netlify.toml`.

## Local Preview

```bash
node build.js
npx serve dist
```
