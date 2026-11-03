# Sponsored cards and “You may also like” mockup

An isolated preview of paid Theatre 118 placements in the actual Glasgow Theatre homepage and show detail pages. It reuses the site's CSS, fonts, filter JavaScript and click tracker. The placements are not added to the production build or live site. Placement-aware tracking support is prepared in the existing Functions for a later deployment.

From `site/`:

```sh
node experiments/sponsored-show/preview.cjs
```

Open http://127.0.0.1:4188. This prepares `index.html` from the existing `dist/index.html`, serves the experiment, and maps the existing assets. Homepage and show detail links stay within the preview; other navigation links go to the real site. Detail pages are rendered on request from the existing `dist/shows/` markup.

Example: http://127.0.0.1:4188/shows/citizens-othello.html#you-may-also-like.

## Design and filter behaviour

- The sponsored show is the first ordinary-sized card in the listings grid, with the same artwork dimensions, title, price line, description and links as a normal show. A faint lilac wash (`#eeebf7`) and a small **Sponsored** label beside the venue disclose the placement.
- It follows the existing three-, two- and one-column responsive grid. The highlight extends 10px into the gutter so the card content stays aligned with its neighbours.
- Search, venue, art form and date filters use the same `Listings.filterEvents` function as the organic results. Matching combinations retain the slot; excluding combinations remove the complete slot, with no empty gap. Reset restores it.
- Date filters also require an available future performance within the requested window. A multi-day run does not qualify solely because a sold-out night overlaps the filter.
- Select the venue's next bookable show first, then apply the visitor's filters. Filtering this show out hides the slot; it does not substitute a later Theatre 118 show.
- The promoted show appears once, at the front of the grid, rather than being repeated in its chronological position. It remains one unique show in the result count.
- Art form comes from the Glasgow Theatre listing matched by the stable booking URL. The venue API calls this show `Show`; the site's classification is `scratch`, displayed as **Scratch / new material**. That filter matches it; Cabaret does not.
- Detail pages put the same sponsored creative first in a three-card **You may also like** section below the full show content and above the footer. Two organic recommendations follow. The promoted show’s own page shows three organic recommendations instead.
- The sponsor hides when it no longer has an available future performance. On detail pages another ranked recommendation fills its place, and expired organic listings are skipped. The homepage leaves no empty gap.

## Recommendations

The preview uses a deterministic content-based score in `recommendations.cjs`:

- Same art form: **6 points**; same venue: **3 points**.
- Other shared tags: **2 points each**, capped at 4.
- Shared keywords in titles, descriptions and tags: up to **8 points**, using cosine similarity with inverse document frequency. Common words and listing boilerplate are ignored; words shared by fewer shows carry more weight.
- Dates near the original show add a small bonus of up to **0.5 points**.

Highest score wins; ties use date then ID. The current show, sponsor, duplicate IDs/booking URLs and ended runs are excluded. If there are fewer than three eligible shows, only eligible cards are shown. Short reasons such as “Also at Citizens Theatre” accompany organic cards. No visitor profile is needed. The ranked pool is prepared per detail-page request; the browser keeps the first two (or three without a sponsor) still-upcoming recommendations visible when the day or availability changes.

For Othello, the current leading organic matches are Do Not Pass Go and An t-Ùrlar as Àirde (The Highest Stage): both plays at Citizens Theatre. All images and listing cards reuse the actual site markup. This remains an isolated mockup; production templates and APIs are unchanged.

## Separate click tracking

Artwork, title and **Prices & times** open the normal local show page. The outbound **Tickets** link uses the existing tracker with `sponsored-home` or `sponsored-detail` as its surface. The destination show's ID and venue receive credit, rather than the show whose detail page hosts the placement. Ordinary booking links retain `card`, `show-hero` or `show-panel`.

The local server accepts `/track` events in bounded session memory only. It does not forward data to production or write to D1. Inspect http://127.0.0.1:4188/preview-clicks for a local report with the same `sponsored` and `surfaces` breakdowns as the prepared production endpoint. Restarting the preview clears these test counts. Browser checks intercept their beacons and suppress external navigation.

Before deploying the updated production tracking Functions, apply `db/migrations/0001_surface_counts.sql`; see the main README. The endpoint exposes the extra breakdown without changing existing overall totals. The current terminal CLI still displays its original columns until its renderer is updated.

## API findings

Source: [Theatre 118 API documentation](https://theatre118.com/api) and [public show feed](https://theatre118.com/api/v1/shows), fetched 30 October 2026. `snapshot.json` is a saved public response, not a live inventory connection. The selected show is **Working it Out - November 2026**, Monday 16 November, 20:00.

No API change is needed for Theatre 118's current in-house bookings. `ticketing.on_sale`, individual performance `date` / `time`, `cancelled`, `sold_out` and `booking_url` support selection. Choose the earliest future, non-cancelled, non-sold-out sitting with a booking URL from an on-sale show. Sort by that sitting, rather than by the run's original start date. A show needs only one qualifying sitting. Fail closed when availability flags are missing; hide the slot if nothing qualifies. All time comparisons use Europe/London.

For a same-day sitting without a time, the prototype cannot prove it is still upcoming and excludes it. Stock at an external box office cannot be established by this feed, so externally ticketed shows are excluded. If those need promotion later, the external seller must supply availability.

The API returns `meta.has_more`; a production integration must traverse pages before selecting. This saved response has both shows and no further pages. The API's five-minute cache is suitable for a future server-side refresh; a daily static build alone would leave stale availability. A live integration should hide expired/unverifiable inventory and refresh the selection, metadata and artwork together. This mockup intentionally does not poll the venue, and may need a new snapshot if reopened after its sample show has passed.

The card shows the snapshot’s starting ticket price, £3, in the normal price badge. The snapshot also records a £1.50 fee per order and Pay What You Can availability; this compact treatment uses the ordinary Prices & times link for further details. Poster from the API's `image.url`, cached locally without cropping. Description is a short editorial summary of the API description. The normal listing's older monthly title is corrected only inside the generated preview.

## Check

With the preview server running:

```sh
node --test experiments/sponsored-show/core.test.cjs experiments/sponsored-show/recommendations.test.cjs
node experiments/sponsored-show/check.cjs
```

The unit suites check recommendation ranking, duplicate/self/past-show exclusions, deterministic results and sparse inputs, as well as eligibility, sold-out/cancelled/unknown states, time boundaries, date-window availability and shared filter rules. The second uses installed Chrome through Playwright, freezes the sample date, exercises the real filters and detail-page placements at four screen widths, verifies paid versus organic beacons and the self-promotion exclusion, checks accessibility with axe, and saves screenshots in `test-results/`.
