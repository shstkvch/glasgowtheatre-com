# Glasgow Theatre

Independent listings for [glasgowtheatre.com](https://glasgowtheatre.com), built as a static site and published with GitHub Pages.

## Develop and check

Requires Node 22+, npm and Python 3 for the local preview server.

```sh
npm ci
npm run refresh
npm run build
npm test
npm run test:browser
npm run preview
```

Local browser tests use installed Google Chrome. CI installs Playwright Chromium. The preview is at http://localhost:4173.

## Add or correct a listing

Edit `data/manual-events.json`. These entries override scraped listings with the same booking URL, so refreshes preserve submitted copy, access details and images. Thrice is a complete example with separate performances and a photo credit.

Include a stable `id`, `title`, `venue`, `venueId` matching `data/venues.json`, ISO `date` and optional `endDate`, `tags`, `description`, and HTTPS `ticketUrl`. Only enter `time` when confirmed by the venue. Add `performances` and `accessibility` for performance-specific access arrangements. Put supplied images in `src/images` and use `/images/filename.webp`.

Set `featured: true` on one manual entry with `producer`, `performances`, `imageAlt` and `imageCredit` to use it as the homepage spotlight. The feature automatically disappears after its final day.

## Refreshing and images

`scripts/scrape-events.js` reads Citizens Theatre, Tron, Tramway, A Play, A Pie and A Pint and The Glad Café. It keeps the last saved upcoming entries for a source returning no events, reports retained venues in `data/refresh-status.json`, and refuses to overwrite data when every source fails. Inspect the logs after a partial failure. A successful response containing some events is treated as that venue's current programme.

`scripts/cache-images.js` downloads and optimises production images into local WebP files. `data/image-cache.json` maps source URLs to local files. Failed downloads use a venue placeholder; a browser fallback also handles missing image files. The original Thrice photograph was supplied for this listing. Fonts are locally hosted with licenses in `src/fonts`.

The build filters expired events in Europe/London time. The browser repeats that check on page load, once a minute, and when a tab becomes visible. Date searches match overlapping runs, not just opening nights. “Next 7 days” includes today and the following six days.

## Publishing

`.github/workflows/publish.yml` builds, tests and publishes `dist` on pushes to `main`. It also refreshes listings daily at 05:17 UTC and can be started manually in GitHub Actions. Scheduled runs commit refreshed data, cached images and generated pages before deploying. GitHub Pages must use the **GitHub Actions** build source, retaining the custom domain `glasgowtheatre.com`.

If a refresh completely fails, the workflow warns and builds the last saved data, removing expired shows. The footer reports the last successful data refresh, not the latest build time. The site covers a selection of current shows; the venue directory includes additional venues without automated programme feeds.

The pre-redesign site is retained at the `pre-redesign-2026-09-09` tag. `netlify.toml` is no longer used.

### Publishing status, 9 September 2026

GitHub rejected the custom Actions job before it started: “The job was not started because your account is locked due to a billing issue.” The tested build was instead pushed to `gh-pages` using the existing Pages publishing route. Pages currently uses `gh-pages` at `/`, with build type `legacy`. Daily refresh automation is configured but cannot run until the account billing lock is resolved.

After resolving GitHub billing, switch Pages to **GitHub Actions** and run the **Refresh and publish theatre listings** workflow manually. This will verify the refresh and restore the scheduled publication path. The `github-pages` environment already permits `main` and `gh-pages` deployments.
