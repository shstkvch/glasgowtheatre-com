# Sponsored Show — homepage and detail-page mockup

An isolated preview of paid Theatre 118 placements in the actual Glasgow Theatre homepage and show detail pages. It reuses the site's CSS, fonts, filter JavaScript and click tracker. The placements are not added to the production build or live site. Placement-aware tracking support is prepared in the existing Functions for a later deployment.

From `site/`:

```sh
node experiments/sponsored-show/preview.cjs
```

Open http://127.0.0.1:4188. This prepares `index.html` from the existing `dist/index.html`, serves the experiment, and maps the existing assets. Homepage and show detail links stay within the preview; other navigation links go to the real site. Detail pages are rendered on request from the existing `dist/shows/` markup.

Example: http://127.0.0.1:4188/shows/citizens-othello.html#sponsored-show.

## Design and filter behaviour

- A horizontal, explicitly labelled **Sponsored Show** below the filters and result count, before the normal chronological listings. Show artwork is displayed whole. Colour, typography, spacing and buttons use Glasgow Theatre's design system.
- On a phone, artwork sits beside the title; price and booking action sit beneath.
- Search, venue, art form and date filters use the same `Listings.filterEvents` function as the organic results. Matching combinations retain the slot; excluding combinations remove the complete slot, with no empty gap. Reset restores it.
- Date filters also require an available future performance within the requested window. A multi-day run does not qualify solely because a sold-out night overlaps the filter.
- Select the venue's next bookable show first, then apply the visitor's filters. Filtering this show out hides the slot; it does not substitute a later Theatre 118 show.
- The show can still appear in its normal chronological position. It remains one unique show in the result count.
- Art form comes from the Glasgow Theatre listing matched by the stable booking URL. The venue API calls this show `Show`; the site's classification is `scratch`, displayed as **Scratch / new material**. That filter matches it; Cabaret does not.
- Detail pages use the same creative below the complete show content, including performances, prices and concessions, and above the footer. The promoted show's own page omits the slot. Other Theatre 118 shows still carry it. Detail pages have no listing filters; their own genre or venue does not filter the sponsor out.
- Both placements hide when the saved show no longer has an available future performance. The complete wrapper disappears, so no empty gap remains.

## Separate click tracking

All outbound sponsored artwork, title and booking links use the existing tracker with `sponsored-home` or `sponsored-detail` as their surface. The destination show's ID and venue receive credit, rather than the show whose detail page hosts the placement. Ordinary booking links retain `card`, `show-hero` or `show-panel`.

The local server accepts `/track` events in bounded session memory only. It does not forward data to production or write to D1. Inspect http://127.0.0.1:4188/preview-clicks for a local report with the same `sponsored` and `surfaces` breakdowns as the prepared production endpoint. Restarting the preview clears these test counts. Browser checks intercept their beacons and suppress external navigation.

Before deploying the updated production tracking Functions, apply `db/migrations/0001_surface_counts.sql`; see the main README. The endpoint exposes the extra breakdown without changing existing overall totals. The current terminal CLI still displays its original columns until its renderer is updated.

## API findings

Source: [Theatre 118 API documentation](https://theatre118.com/api) and [public show feed](https://theatre118.com/api/v1/shows), fetched 30 October 2026. `snapshot.json` is a saved public response, not a live inventory connection. The selected show is **Working it Out - November 2026**, Monday 16 November, 20:00.

No API change is needed for Theatre 118's current in-house bookings. `ticketing.on_sale`, individual performance `date` / `time`, `cancelled`, `sold_out` and `booking_url` support selection. Choose the earliest future, non-cancelled, non-sold-out sitting with a booking URL from an on-sale show. Sort by that sitting, rather than by the run's original start date. A show needs only one qualifying sitting. Fail closed when availability flags are missing; hide the slot if nothing qualifies. All time comparisons use Europe/London.

For a same-day sitting without a time, the prototype cannot prove it is still upcoming and excludes it. Stock at an external box office cannot be established by this feed, so externally ticketed shows are excluded. If those need promotion later, the external seller must supply availability.

The API returns `meta.has_more`; a production integration must traverse pages before selecting. This saved response has both shows and no further pages. The API's five-minute cache is suitable for a future server-side refresh; a daily static build alone would leave stale availability. A live integration should hide expired/unverifiable inventory and refresh the selection, metadata and artwork together. This mockup intentionally does not poll the venue, and may need a new snapshot if reopened after its sample show has passed.

Prices are from the snapshot: £3 tickets, a £1.50 fee per order, and Pay What You Can availability. Poster from the API's `image.url`, cached locally without cropping. Description is a short editorial summary of the API description. The normal listing's older monthly title is corrected only inside the generated preview.

## Check

With the preview server running:

```sh
node --test experiments/sponsored-show/core.test.cjs
node experiments/sponsored-show/check.cjs
```

The first checks eligibility, sold-out/cancelled/unknown states, time boundaries, date-window availability and shared filter rules. The second uses installed Chrome through Playwright, freezes the sample date, exercises the real filters and detail-page placements at four screen widths, verifies paid versus organic beacons and the self-promotion exclusion, checks accessibility with axe, and saves screenshots in `test-results/`.
