# Glasgow Theatre

Independent listings for [glasgowtheatre.com](https://glasgowtheatre.com), built as a static site and published with GitHub Pages.

## Develop and check

Requires Node 22+, npm and Python 3 for the local preview server.

```sh
npm ci
cp .env.example .env   # then add your OpenRouter key
npm run refresh
npm run build
npm test
npm run test:browser
npm run preview
```

Local browser tests use installed Google Chrome. CI installs Playwright Chromium. The preview is at http://localhost:4173.

## Add or correct a listing

Listings that arrive by email are added by hand to `data/manual-events.json`. There is no database: the file is the record, and it is version controlled with everything else.

An entry overrides any scraped listing with the same booking URL, so a refresh never overwrites copy, access details or images that someone sent in. An entry for a show no venue feed carries simply appears on its own.

Required fields are `id`, `title`, `venue`, `venueId` (matching `data/venues.json`), ISO `date` and an HTTPS `ticketUrl`. Optional: `endDate`, `time` (24-hour `HH:MM`, only when the venue has confirmed it), `tags`, `description`, `producer`, `accessibility` and `performances`. Put supplied images in `src/images` and reference them as `/images/filename.webp`, with `imageAlt` and `imageCredit`.

`npm run build` validates the file and fails with a list of problems rather than publishing a broken card. Thrice is a complete worked example.

Tags on manual entries are kept as written. The tagger only touches scraped listings, so a hand-picked tag is never overwritten.

## Tagging

`scripts/tag-events.js` assigns genre tags with a cheap LLM through OpenRouter, replacing keyword matching that used to tag any listing containing the word "improv" as comedy. Tags come from a fixed vocabulary in the script, so the filter pills stay a stable set and the model cannot invent one.

Results are cached in `data/tag-cache.json`, keyed by a hash of the text the model sees. Each listing is sent once: a daily refresh costs nothing for shows already tagged, and re-running is free. Editing a description re-tags that listing on the next run. Tagging 48 listings from scratch costs about \$0.001.

`talk`, `workshop` and `tour` mark events that are not performances to watch, and are exclusive: a discussion about a play is a talk, not a talk and a drama. `a-play-a-pie-a-pint`, `lunchtime` and `scratch` come from the source rather than the text, and the tagger preserves them.

Set `OPENROUTER_API_KEY` in `.env` (see `.env.example`), or `OPENROUTER_MODEL` to use a different model. Without a key, or if the API fails, tagging falls back to keyword matching and exits successfully — it never breaks a build. Run `npm run tag -- --dry-run` to preview changes, or `--retag` to ignore the cache.

Òran Mór's lunchtime season carries `season: "A Play, A Pie and A Pint"`, which is what a card shows instead of the building name. The label still links to the Òran Mór venue page.

## Refreshing and images

`scripts/scrape-events.js` reads Citizens Theatre, Tron, Tramway, A Play, A Pie and A Pint and The Glad Café. It keeps the last saved upcoming entries for a source returning no events, reports retained venues in `data/refresh-status.json`, and refuses to overwrite data when every source fails. Inspect the logs after a partial failure. A successful response containing some events is treated as that venue's current programme.

`scripts/cache-images.js` downloads and optimises production images into local WebP files. `data/image-cache.json` maps source URLs to local files. Failed downloads use a venue placeholder; a browser fallback also handles missing image files. The original Thrice photograph was supplied for this listing. Fonts are locally hosted with licenses in `src/fonts`.

The build filters expired events in Europe/London time. The browser repeats that check on page load, once a minute, and when a tab becomes visible. Date searches match overlapping runs, not just opening nights. “Next 7 days” includes today and the following six days.

## Publishing

Cloudflare Pages builds and serves the site, rebuilt daily by a Worker. See **Daily updates on Cloudflare** below for how it is wired and how to set it up.

`.github/workflows/publish.yml` is kept as a fallback: it does the same job through GitHub Actions and now passes `OPENROUTER_API_KEY` from repository secrets, but it cannot run while the account is billing-locked.

If a refresh completely fails, the build warns and uses the last saved data, removing expired shows. The footer reports the last successful data refresh, not the latest build time. The site covers a selection of current shows; the venue directory includes additional venues without automated programme feeds.

The pre-redesign site is retained at the `pre-redesign-2026-09-09` tag.

## Daily updates on Cloudflare

The site is built and served by **Cloudflare Pages**, rebuilt daily by a Cloudflare Worker. Nothing needs a machine of yours to be awake, and it does not depend on GitHub Actions, which cannot run while the account is billing-locked.

```
Worker (cron 05:17 UTC) ──POST──▶ Pages deploy hook
                                        │
                                        ▼
                          npm run build:cloudflare
                    refresh → tag → test → build → report
                                        │
                                        ▼
                              deploy to glasgowtheatre.com
```

Run `./scripts/setup-cloudflare.sh` to do the setup. It is a ten-stage wizard that opens each page, says what to click, and saves the values it captures into `.env`: Cloudflare account and zone, the nameserver move from Porkbun, Resend, the Pages project and its environment variables, the domain cutover, the deploy hook, and deploying the Worker. It is safe to re-run; existing answers come back as defaults.

The Pages project needs three environment variables: `OPENROUTER_API_KEY`, `RESEND_API_KEY` and `REPORT_TO`. Build command `npm run build:cloudflare`, output directory `dist`, Node from `.node-version`.

Builds run from a fresh checkout, which is fine and is why no data is committed back: cached images are named by a hash of their source URL and committed, so only genuinely new artwork is downloaded, and the tag cache means only new shows are sent to the model. A venue that fails falls back to the last saved listings with expired shows removed.

### The daily report

`scripts/report-new.js` emails through Resend when new shows appear, and stays quiet otherwise. It needs no database and no state file: `build.js` publishes the listings as `/data/events.json`, so the currently live site is the baseline and today's deploy becomes tomorrow's comparison. It runs before the deploy, while the previous build is still live.

A first run with no published feed sets the baseline silently. A failed report never fails a deploy. Preview it with `npm run report -- --dry-run`.

Until a sending domain is verified, Resend delivers only to the account owner's address, from `onboarding@resend.dev`. To send from the site's own domain, verify it in Resend, add the DNS records in Cloudflare, and set `REPORT_FROM`.

### Checking it ran

`/data/status.json` is published on every build, so you can tell from outside whether the unattended job worked:

```sh
curl -s https://glasgowtheatre.com/data/status.json
```

`builtAt` says when the site was last built and `refreshedAt` when the listings were last successfully pulled from the venues. If `builtAt` moves each morning but `refreshedAt` does not, the build is running but the scrape is failing. `retainedVenues` names any venue serving stale data.

### The cron Worker

`cloudflare/` holds the Worker that starts the daily build. It POSTs the deploy hook at 05:17 UTC and does nothing else.

Deploy it with `./scripts/deploy-worker.sh`, which handles the login, the secrets and the deploy. **Nothing runs on a schedule until this is done** — Cloudflare Pages only rebuilds when something tells it to.

```sh
./scripts/deploy-worker.sh          # login, secrets, deploy
cd cloudflare
npx wrangler tail                   # watch it fire
curl -X POST "https://glasgowtheatre-build.<subdomain>.workers.dev/trigger?key=$TRIGGER_KEY"
```

### Publishing by hand

`scripts/publish.sh` still does the whole job locally — refresh, test, build, commit and push to `gh-pages` — for when you want to publish immediately rather than wait for the cron, or if Cloudflare is ever unavailable. It refuses to run on a dirty tree or a branch other than `main`.


### Publishing status, 9 September 2026

The site is live on **Cloudflare Pages**, rebuilt daily by the Worker at 05:17 UTC. Nameservers moved from Porkbun to Cloudflare and the domain was cut over from GitHub Pages, so `gh-pages` is no longer what visitors see and the branch is now historical.

GitHub Actions still cannot run — “The job was not started because your account is locked due to a billing issue.” `.github/workflows/publish.yml` is kept as a fallback only. Nothing depends on it.

Verified working end to end: the Worker triggers the deploy hook, Cloudflare builds and deploys in about a minute, and the scrape reaches the venues from Cloudflare's network.
