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

`.github/workflows/publish.yml` builds, tests and publishes `dist` on pushes to `main`. It also refreshes listings daily at 05:17 UTC and can be started manually in GitHub Actions. Scheduled runs commit refreshed data, cached images and generated pages before deploying. GitHub Pages must use the **GitHub Actions** build source, retaining the custom domain `glasgowtheatre.com`.

If a refresh completely fails, the workflow warns and builds the last saved data, removing expired shows. The footer reports the last successful data refresh, not the latest build time. The site covers a selection of current shows; the venue directory includes additional venues without automated programme feeds.

The pre-redesign site is retained at the `pre-redesign-2026-09-09` tag. `netlify.toml` is no longer used.

## Daily updates without GitHub Actions

GitHub Actions cannot run while the account is billing-locked, but Pages still **serves** the `gh-pages` branch, so only the daily compute needs a new home.

`scripts/publish.sh` is that job in one place, independent of any CI: it syncs `main`, refreshes listings, tags them, caches images, runs both test suites, builds, commits the refreshed data, and pushes `dist` to `gh-pages`. It refuses to run on a dirty tree or a branch other than `main`, and skips the push when nothing changed. A failed refresh is survivable: it publishes the last saved listings with expired shows removed.

```sh
./scripts/publish.sh --dry-run   # everything except the push
./scripts/publish.sh             # the real thing
./scripts/publish.sh --log       # append to logs/publish-YYYY-MM-DD.log
```

Anything that can run a command daily can drive it. In rough order of least disruption:

| Option | Cost | Trade-off |
| --- | --- | --- |
| Fix the GitHub billing lock | Existing plan | Nothing to rebuild; the workflow is already written and now passes `OPENROUTER_API_KEY` |
| `launchd` on a Mac | Free | Keeps hosting and the commit-back behaviour exactly as they are, but only runs while the machine is awake and online |
| Cloudflare Pages or Netlify scheduled build | Free tier | Reliable and unattended, but hosting and the custom domain move off GitHub Pages, and refreshed data is no longer committed back to the repo |
| A small always-on box (VPS, Raspberry Pi) with cron | Cheap or free | Full control, one more machine to maintain |

For `launchd`, `scripts/com.glasgowtheatre.publish.plist` runs the job at 05:17 daily:

```sh
cp scripts/com.glasgowtheatre.publish.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.glasgowtheatre.publish.plist
launchctl start com.glasgowtheatre.publish   # run once now to check
```

It needs an SSH key that can push to the repo, and `.env` present for the tagging key. If the Mac is asleep at 05:17, launchd runs the job at the next wake.

### Publishing status, 9 September 2026

GitHub rejected the custom Actions job before it started: “The job was not started because your account is locked due to a billing issue.” The tested build was instead pushed to `gh-pages` using the existing Pages publishing route. Pages currently uses `gh-pages` at `/`, with build type `legacy`. Daily refresh automation is configured but cannot run until the account billing lock is resolved.

After resolving GitHub billing, switch Pages to **GitHub Actions** and run the **Refresh and publish theatre listings** workflow manually. This will verify the refresh and restore the scheduled publication path. The `github-pages` environment already permits `main` and `gh-pages` deployments.
