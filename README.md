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

## The calendar

`/calendar.html` is a swim-lane timeline: a lane per venue, a column per day, and a bar per run whose width is exactly how long that run lasts. It opens on today and scrolls sideways through roughly six months.

`scripts/calendar.js` builds the model and `build.js` renders it. The parts worth knowing:

- **Packing.** Overlapping runs at one venue stack onto extra tracks within the same lane. A run reserves at least five days of its track even if it is a single night, so a one-night show's title has somewhere to sit; that is why a lane can have more tracks than a naive reading of the dates suggests.
- **Clipping.** A run that started before the window, or carries on past its far edge, is drawn to the edge with a flat end rather than a rounded one, so a bar never claims to begin or finish where it does not.
- **Lane names.** Where every listing in a lane shares a season the lane takes the season's name and the venue drops to the line below — the Òran Mór lane reads "A Play, A Pie and A Pint".
- **Colour.** Each venue wears its own brand colour, listed with its source in `VENUE_COLOURS` in `build.js`. Bar titles are drawn in whichever house ink is legible on that colour, and a colour that clears neither is nudged the smallest step towards black or white that works. The build fails rather than publish a title nobody can read, and a browser test measures the rendered contrast.

Everything above works without JavaScript. Script adds the hover preview, the month buttons, drag-to-scroll and the jump to today.

## Add or correct a listing

Listings that arrive by email are added by hand to `data/manual-events.json`. There is no database: the file is the record, and it is version controlled with everything else.

An entry overrides any scraped listing with the same booking URL, so a refresh never overwrites copy, access details or images that someone sent in. An entry for a show no venue feed carries simply appears on its own.

Required fields are `id`, `title`, `venue`, `venueId` (matching `data/venues.json`), ISO `date`, an HTTPS `ticketUrl` and `form` (one of the art forms in `scripts/art-forms.js`). Optional: `endDate`, `time` (24-hour `HH:MM`, only when the venue has confirmed it), `tags`, `description`, `producer`, `accessibility` and `performances`. Put supplied images in `src/images` and reference them as `/images/filename.webp`, with `imageAlt` and `imageCredit`.

`npm run build` validates the file and fails with a list of problems rather than publishing a broken card. Thrice is a complete worked example.

Art forms on manual entries are kept as written. The tagger only touches scraped listings, so a hand-picked form is never overwritten.

## Tagging

`scripts/tag-events.js` assigns one art form per listing with a cheap LLM through OpenRouter, replacing keyword matching that used to tag any listing containing the word "improv" as comedy. Art forms come from a fixed vocabulary in `scripts/art-forms.js`, including play, musical, opera, dance and stand-up. Cards and filters show only the art form; genres and subgenres are deferred.

Results are cached in `data/tag-cache.json`, keyed by a hash of the text the model sees. Each listing is sent once: a daily refresh costs nothing for shows already tagged, and re-running is free. Editing a description re-tags that listing on the next run. Tagging 48 listings from scratch costs about \$0.001.

### What belongs on the site

Most of these venues programme more than theatre: the Old Hairdressers and the Glad Café are mostly music, the Pavilion sells a lot of tribute acts, and Platform runs knitting groups. Those venues are marked `mixedProgramme` in `data/venues.json`, and their listings have to earn a place. A dedicated theatre's do not, because everything it stages is in scope.

The decision is made by the same model call that assigns tags, which returns `inScope` and a short reason alongside them. Where the source publishes a category that settles it — ATG filing something under Musicals, the Pavilion under Play — no verdict is asked for; only the genuinely ambiguous ones cost anything. This replaced a keyword whitelist on the Glad Café scraper that ran on the title alone, before any description had been fetched, so it admitted anything containing "improv" while dropping every play whose title happened not to say so.

It fails open. A listing with no verdict — the API was down, the response was malformed — stays on the site; an outage must never quietly empty the listings. Every exclusion is logged with its reason and reported in the daily email, so a wrong call surfaces the next morning rather than vanishing. A wrongly dropped show can be forced back through `data/manual-events.json`, which overrides everything.

`talk`, `workshop` and `tour` are forms for events that are not performances to watch: a discussion about a play is a talk. `a-play-a-pie-a-pint`, `lunchtime` and `scratch` remain searchable source metadata, but do not appear as art-form filters.

Set `OPENROUTER_API_KEY` in `.env` (see `.env.example`), or `OPENROUTER_MODEL` to use a different model. Without a key, or if the API fails, tagging falls back to keyword matching and exits successfully — it never breaks a build. Run `npm run tag -- --dry-run` to preview changes, or `--retag` to ignore the cache.

Òran Mór's lunchtime season carries `season: "A Play, A Pie and A Pint"`, which is what a card shows instead of the building name. The label still links to the Òran Mór venue page.

## Refreshing and images

`scripts/scrape-events.js` reads eleven sources: Citizens Theatre, Tron, Tramway, A Play, A Pie and A Pint, The Glad Café, the King's, Theatre Royal, the Pavilion, Platform, Cottiers and The Old Hairdressers.

The King's and Theatre Royal are both ATG houses and share one parser, `scrapeATG`, which walks the paginated what's-on URLs that ATG's robots.txt explicitly allows and reads the listings out of the React Server Component payload. The Pavilion's own domain redirects to Trafalgar's platform, whose payload carries an ISO `startDate`. Platform publishes no year on a listing, so the year is read from the `evmon-October-2026` class names on each item. Cottiers is a WP Event Manager install. The Old Hairdressers publishes neither meta description nor category, so its blurb comes from the longest paragraph on the event page.

Listings are capped at a six-month horizon (`HORIZON_MONTHS`), applied once in `main()` so every source is cut off alike — ATG publishes nearly a year ahead, which would otherwise bury what is on this week. Deduplication keys on venue *and* title: a touring show plays more than one house, and Building And Heritage Tours runs at both ATG venues under one name.

Show descriptions are cached in `data/description-cache.json`, keyed by URL, so a listing costs one fetch the first time it is seen and nothing afterwards. It keeps the last saved upcoming entries for a source returning no events, reports retained venues in `data/refresh-status.json`, and refuses to overwrite data when every source fails.

### Canaries

A scraper that returns nothing is easy to spot. A scraper that quietly returns half of what it should, because a venue renamed one CSS class, is not: the site keeps building and the listings just get thinner. Each scraper declares the structural markers it depends on — `.listings__item--event` at Platform, `eventCards` in the Trafalgar payload, `"buyTickets"` in ATG's — and a missing marker is recorded in `refresh-status.json` under `canaries`, published in `/data/status.json`, and named in the daily email. A source that neither threw nor returned anything trips a canary too. Inspect the logs after a partial failure. A successful response containing some events is treated as that venue's current programme.

`scripts/cache-images.js` downloads and optimises production images into local WebP files. `data/image-cache.json` maps source URLs to local files. Failed downloads use a venue placeholder; a browser fallback also handles missing image files. The original Thrice photograph was supplied for this listing. Fonts are locally hosted with licenses in `src/fonts`.

The build filters expired events in Europe/London time. The browser repeats that check on page load, once a minute, and when a tab becomes visible. Date searches match overlapping runs, not just opening nights. “Next 7 days” includes today and the following six days.

## Publishing

Cloudflare Pages builds and serves the site, rebuilt daily by a Worker. See **Daily updates on Cloudflare** below for how it is wired and how to set it up.

`.github/workflows/publish.yml` no longer deploys anything. It used to publish to GitHub Pages on every push, which would now be publishing to a place nobody visits and racing the build Cloudflare has already started for the same commit. It is a manual trigger for the Cloudflare deploy hook and nothing else, for when the Worker is broken and you are not at a machine with the repo checked out. It needs a `DEPLOY_HOOK` repository secret, and still cannot run while the account is billing-locked.

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

`scripts/report-new.js` emails through Resend on every run. When new shows appear it lists them; when nothing has changed it sends a short confirmation instead, so a morning with no email means the job did not run rather than that there was nothing to say. It needs no database and no state file: `build.js` publishes the listings as `/data/events.json`, so the currently live site is the baseline and today's deploy becomes tomorrow's comparison. It runs before the deploy, while the previous build is still live.

Every email ends with the run summary: how many shows are listed, when the listings were last refreshed, any venue serving saved listings, and what tagging spent. Most days nothing needs tagging and that line reads £0.00. `scripts/tag-events.js` writes `data/tag-usage.json` on each run and `build.js` copies it into `/data/status.json`, so the spend is also visible from outside. OpenRouter bills in dollars and the report converts at an approximate rate; set `GBP_PER_USD` to change it.

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

A push to `main` is already a deploy: the Pages project is connected to the repo and starts a build within seconds of the push, taking about a minute. The cron Worker and the deploy hook are for rebuilding *without* a push, to pick up new listings from the venues.

`scripts/publish.sh` does the whole job locally — refresh, test, build, commit, push to `main` and then POST the deploy hook — for when you want to publish immediately rather than wait for the cron. It refuses to run on a dirty tree or a branch other than `main`. To rebuild from the current commit without changing anything:

```sh
set -a; . ./.env; set +a
curl -fsS -X POST "$DEPLOY_HOOK"
```


### Publishing status, 9 September 2026

The site is live on **Cloudflare Pages**, rebuilt daily by the Worker at 05:17 UTC. Nameservers moved from Porkbun to Cloudflare and the domain was cut over from GitHub Pages, so `gh-pages` is no longer what visitors see and the branch is now historical.

GitHub Actions still cannot run — “The job was not started because your account is locked due to a billing issue.” `.github/workflows/publish.yml` is kept as a fallback only. Nothing depends on it.

Verified working end to end: the Worker triggers the deploy hook, Cloudflare builds and deploys in about a minute, and the scrape reaches the venues from Cloudflare's network.
