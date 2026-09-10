const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  londonDate,
  filterEvents,
  countArtForms,
  mergeListings,
} = require("./src/js/listings");
const { buildTimeline } = require("./scripts/calendar");
const { FORMS, fallbackForm, combine } = require("./scripts/art-forms");
const {
  priceLabel,
  timesLabel,
  clockTime,
  durationLabel,
  money,
  concessionSource,
} = require("./scripts/tickets");
const DIST = path.join(__dirname, "dist");
const SITE = "https://glasgowtheatre.com";
const today = londonDate();
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "data", name), "utf8"));
const venues = read("venues.json");
const images = read("image-cache.json");
const status = read("refresh-status.json");
// Hand-maintained: what each venue's own concession schemes actually are,
// with the page they were read from and the date they were checked. Nothing
// here is scraped, because none of these venues publishes it in a form a
// scraper could trust, and a wrong price is worse than no price.
const concessions = read("concessions.json");
// Absent when a model pass has never run; the daily report treats a missing
// file as no spend rather than as a failure.
const usage = (name) => {
  try {
    return read(name);
  } catch {
    return null;
  }
};
const tagUsage = usage("tag-usage.json");
const ticketUsage = usage("ticket-usage.json");
/**
 * Manual entries are hand-edited, so a typo here is a broken card in
 * production. Fail the build loudly instead of publishing something odd.
 */
function checkManual(entries) {
  const ids = new Set(venues.map((v) => v.id));
  const problems = entries.flatMap((entry, i) => {
    const where = entry.id || entry.title || `entry ${i + 1}`;
    const need = ["id", "title", "venue", "venueId", "date", "ticketUrl", "form"];
    return [
      ...(entry.form && !Object.hasOwn(FORMS, entry.form)
        ? [`${where}: unknown art form "${entry.form}"`]
        : []),
      ...need.filter((f) => !entry[f]).map((f) => `${where}: missing "${f}"`),
      ...(entry.venueId && !ids.has(entry.venueId)
        ? [`${where}: venueId "${entry.venueId}" is not in venues.json`]
        : []),
      ...(entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
        ? [`${where}: date "${entry.date}" is not YYYY-MM-DD`]
        : []),
      ...(entry.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(entry.endDate)
        ? [`${where}: endDate "${entry.endDate}" is not YYYY-MM-DD`]
        : []),
      ...(entry.endDate && entry.date && entry.endDate < entry.date
        ? [`${where}: endDate is before date`]
        : []),
      ...(entry.ticketUrl && !entry.ticketUrl.startsWith("https://")
        ? [`${where}: ticketUrl must be https`]
        : []),
      ...(entry.time && !/^\d{2}:\d{2}$/.test(entry.time)
        ? [`${where}: time "${entry.time}" is not 24-hour HH:MM`]
        : []),
    ];
  });
  if (problems.length) {
    console.error(
      `\n✗ data/manual-events.json has ${problems.length} problem(s):`,
    );
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("");
    process.exit(1);
  }
  return entries;
}
const events = filterEvents(
  mergeListings(read("events.json"), checkManual(read("manual-events.json"))),
).map((e) => ({
  ...e,
  form: fallbackForm(e),
  tags: combine(e, e.form),
  image: e.image?.startsWith("/") ? e.image : images[e.image] || null,
}));
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const date = (value, year = false) =>
  new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
  });
const time = (value) => {
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}.${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
};
const range = (event) =>
  `${date(event.date)}${event.endDate && event.endDate !== event.date ? " – " + date(event.endDate) : ""} ${event.date.slice(0, 4)}`;
const label = (value) =>
  value
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
const arrow = '<span aria-hidden="true">↗</span>';
/**
 * A content hash on every stylesheet and script URL.
 *
 * Cloudflare serves these with `max-age=14400` and the HTML with none, so a
 * visitor who came yesterday gets today's markup styled by yesterday's CSS —
 * and every class added since renders unstyled for four hours. A hash in the
 * URL makes a changed file a different file, so the browser has to fetch it.
 *
 * style.css `@import`s fonts.css, which the browser caches under its own URL,
 * so a change to either has to move the hash.
 */
const IMPORTED = { "css/style.css": ["css/fonts.css"] };
const asset = (file) =>
  `/${file}?v=${crypto
    .createHash("sha1")
    .update(
      Buffer.concat(
        [file, ...(IMPORTED[file] || [])].map((part) =>
          fs.readFileSync(path.join(__dirname, "src", part)),
        ),
      ),
    )
    .digest("hex")
    .slice(0, 8)}`;
/* ------------------------------------------------- tickets, times, prices */
/** The venue's own concession schemes, where it publishes any. */
const scheme = (event) => concessions[event.venueId] || null;
/** Every show has a page of its own, and this is where it lives. */
const showPath = (event) => `/shows/${event.id}.html`;
/** "From £18 (conc. from £5)", or nothing at all when nobody published a price. */
const price = (event) => priceLabel(event.pricing, scheme(event));
/**
 * When the curtain goes up, in as few words as the run allows. A venue that
 * publishes its times as a sentence — "Monday – Saturday 1pm", "Day & evening
 * shows" — gets to keep the sentence, because summarising it would lose the
 * only thing it says.
 */
const when = (event) =>
  timesLabel(event.performances, event.time) ||
  (event.scheduleText && event.scheduleText.length <= 46 ? event.scheduleText : null);
function write(name, text) {
  const target = path.join(DIST, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
function eventData(event) {
  return {
    "@context": "https://schema.org",
    "@type": "TheaterEvent",
    name: event.title,
    description: event.description,
    // A performance time makes the start a moment rather than a day, which is
    // what a search result needs to show "7.30pm" beside the date.
    startDate: event.time ? `${event.date}T${event.time}` : event.date,
    endDate: event.endDate || event.date,
    url: SITE + showPath(event),
    ...(event.duration ? { duration: `PT${event.duration}M` } : {}),
    ...(event.pricing && event.pricing.from != null
      ? {
          offers: {
            "@type": "Offer",
            url: event.ticketUrl,
            price: event.pricing.from,
            priceCurrency: "GBP",
            availability: "https://schema.org/InStock",
          },
        }
      : {}),
    ...(event.image ? { image: SITE + event.image } : {}),
    ...(event.producer
      ? { organizer: { "@type": "Organization", name: event.producer } }
      : {}),
    location: {
      "@type": "PerformingArtsTheater",
      name: event.venue,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Glasgow",
        addressCountry: "GB",
      },
    },
  };
}
function page(
  title,
  description,
  url,
  body,
  active = "events",
  pageEvents = events,
) {
  const nav = [
    ["events", "/", "What’s on"],
    ["calendar", "/calendar.html", "Calendar"],
    ["venues", "/venues.html", "Venues"],
    ["about", "/about.html", "About"],
    ["submit", "/submit.html", "List your show ↗"],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} | Glasgow Theatre</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${SITE}${url}">
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${SITE}${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="Glasgow Theatre"><meta property="og:image" content="${SITE}/images/thrice.webp"><meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#303fce">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${asset("css/style.css")}">
<script defer src="${asset("js/listings.js")}"></script><script defer src="${asset("js/main.js")}"></script></head><body>
<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="container header-inner"><a class="brand" href="/" aria-label="Glasgow Theatre home">GLASGOW<span>THEATRE<span class="brand-dot">●</span></span></a>
<details class="nav-menu" open><summary class="nav-toggle"><span class="nav-bars" aria-hidden="true"></span><span class="nav-toggle-label">Menu</span></summary><nav aria-label="Main navigation">${nav.map(([key, href, text]) => `<a href="${href}"${active === key ? ' aria-current="page"' : ""}>${text}</a>`).join("")}</nav></details></div></header>
<main id="main">${body}</main>
<footer class="site-footer"><div class="container"><div class="footer-top"><div><a class="brand" href="/">GLASGOW<span>THEATRE<span class="brand-dot">●</span></span></a><p>Big stages. Small rooms. A whole city of stories.</p></div><div><p class="eyebrow">Made for the audience</p><a href="/about.html">About this independent guide ${arrow}</a><a href="/submit.html">Get your show listed ${arrow}</a><a href="mailto:info@glasgowtheatre.com">Get in touch ${arrow}</a></div></div><div class="footer-bottom"><span>© ${today.slice(0, 4)} Glasgow Theatre</span><span>Listings refreshed ${date(londonDate(new Date(status.refreshedAt)), true)} · Always check details with the venue.</span></div></div></footer>
<script type="application/ld+json">${json({ "@context": "https://schema.org", "@type": "WebSite", name: "Glasgow Theatre", url: SITE })}</script>${active === "events" ? `<script type="application/ld+json">${json(pageEvents.map(eventData))}</script>` : ""}
<script>window.EVENTS = ${json(pageEvents)};</script></body></html>`;
}
/**
 * A show on the listings.
 *
 * The title and the thumbnail open the show's own page, where the prices, the
 * concessions and every performance are collected; the ticket link still goes
 * straight to the venue, so nobody who only wants to book is made to travel
 * through us to do it.
 */
function card(event) {
  const cost = price(event);
  const times = when(event);
  return `<article class="event-card" id="${e(event.id)}" data-id="${e(event.id)}" data-date="${e(event.date)}" data-end-date="${e(event.endDate || event.date)}">
<div class="event-card-image${event.image ? "" : " image-unavailable"}"><a class="event-card-thumb" href="${e(showPath(event))}" tabindex="-1"><div class="image-fallback" aria-hidden="true"><span>ON STAGE AT</span><strong>${e(event.venue)}</strong></div>${event.image ? `<img src="${e(event.image)}" alt="${e(event.imageAlt || event.title)}" width="1100" height="688" loading="lazy">` : ""}</a><span class="date-stamp">${e(range(event))}</span></div>
<div class="event-card-body"><div class="card-topline"><a href="/venues/${e(event.venueId)}.html">${e(event.season || event.venue)}</a><span>${e(label(event.form))}</span></div>
<h3><a href="${e(showPath(event))}">${e(event.title)}</a></h3>
<p class="card-when">${times ? `<span class="fact-time">${e(times)}</span>` : ""}${cost ? `<span class="fact-price">${e(cost)}</span>` : `<span class="fact-unknown">Prices at the venue</span>`}</p>
<p class="event-description">${e(event.description)}</p>
${event.accessibility ? `<p class="accessibility"><span aria-hidden="true">✳</span> ${e(event.accessibility)}</p>` : ""}
<div class="event-card-footer"><a class="detail-link" href="${e(showPath(event))}">Prices &amp; times</a><a class="ticket-link" href="${e(event.ticketUrl)}" aria-label="Tickets for ${e(event.title)}">Tickets ${arrow}</a></div></div></article>`;
}
const venueCount = new Set(events.map((event) => event.venueId)).size;
const formCounts = countArtForms(events);
const forms = Object.keys(formCounts).sort(
  (a, b) => formCounts[b] - formCounts[a] || a.localeCompare(b),
);
write(
  "index.html",
  page(
    "What’s on across Glasgow’s stages",
    "Find your next theatre night in Glasgow. Browse current shows, dance, new writing and experimental performance, with direct booking links.",
    "/",
    `
<section class="listings-section" id="all-events"><div class="container"><div class="listings-header"><div class="listings-title"><p class="eyebrow">Your independent guide to Glasgow’s stages</p><h1>What’s on.</h1></div><p class="listings-count"><span class="live-dot" aria-hidden="true"></span><strong data-upcoming-count>${events.length}</strong> shows on across <strong data-venue-count>${venueCount}</strong> venues<button class="text-button" id="this-week">Just the next 7 days <span aria-hidden="true">↘</span></button></p></div>
<details class="filter-controls" open><summary class="filter-summary">Search and filter<span aria-hidden="true">▾</span></summary><div class="filter-row"><label class="search-field">Search shows<input id="filter-search" type="search" placeholder="A show, a venue, a story…"></label><label>Venue<select id="filter-venue"><option value="">All venues</option>${venues
      .filter((v) => events.some((event) => event.venueId === v.id))
      .map((v) => `<option value="${v.id}">${e(v.name)}</option>`)
      .join(
        "",
      )}</select></label><label>From<input id="filter-date-from" type="date"></label><label>To<input id="filter-date-to" type="date"></label></div><div class="filter-pills-group" aria-label="Filter by art form"><button class="filter-pill active" data-form="" aria-pressed="true">All shows <span class="filter-pill-count">${events.length}</span></button>${forms.map((form) => `<button class="filter-pill" data-form="${e(form)}" aria-pressed="false">${e(label(form))} <span class="filter-pill-count">${formCounts[form]}</span></button>`).join("")}</div></details>
<div class="results-bar"><span id="results-count" role="status" aria-live="polite">${events.length} shows</span><button class="text-button" data-reset>Clear filters <span aria-hidden="true">×</span></button></div>
<div class="events-grid" id="events-grid">${events.map(card).join("")}</div><div class="no-results" id="no-results" hidden><h3>A different night, perhaps?</h3><p>No shows match these filters. Try another date, venue or art form.</p><button class="btn" data-reset>Clear filters</button></div></div></section>
<section class="listing-invite"><div class="container"><div><p class="eyebrow">For the people making it happen</p><h2>Your show.<br>Our next night out.</h2><p>Putting on theatre in Glasgow? Let the city know.</p></div><a class="btn" href="/submit.html">List your show — it’s free ${arrow}</a></div></section>`,
  ),
);
/* ---------------------------------------------------------------- calendar */
/** Each venue wears its own house colour, taken from its own branding: the
    Citz's black, the Tron's pink, ATG's electric purple at the King's, Òran
    Mór's orange. Where a venue has no colour of its own — a black-and-white
    identity, or no site to read one from — it gets one from the reserve that
    nothing else has claimed, and the reason is noted beside it. */
const VENUE_COLOURS = {
  citizens: "#111111", // black-and-white typographic identity
  tron: "#e91d75", // the Tron's pink, from its own stylesheet
  tramway: "#4a4f57", // monochrome too — graphite, so it is not the Citz
  "oran-mor": "#e74825", // Òran Mór's orange, over its deep green
  "glad-cafe": "#f0bd0f", // the Glad's yellow
  platform: "#6626ff", // its own purple, close to the King's ATG violet
  "southside-fringe": "#0051c3",
  cottiers: "#314e42", // the green Cottiers builds its site on
  kings: "#5a00ff", // ATG electric purple
  "theatre-royal": "#d0202d", // ATG red, and the auditorium's own
  pavilion: "#256d58", // its accent green; the masthead navy reads as black
  "old-hairdressers": "#6f7f3a", // the olive running through its artwork
  mono: "#0e7c8c", // no colour of its own: reserve teal
};
const RESERVE = ["#b039d8", "#ff9500", "#2ad4c8", "#8c1c5a", "#3e6815"];
const luminance = (hex) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + [0.2126, 0.7152, 0.0722][i] * v, 0);
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** Whichever of the two house inks the title will actually be legible in. */
const barInk = (colour) =>
  contrast(colour, "#ffffff") >= contrast(colour, "#20202c")
    ? "#ffffff"
    : "#20202c";
const legible = (colour) => contrast(colour, barInk(colour)) >= 4.5;
/** Moves a colour towards black or white, keeping its hue and saturation. */
function shade(hex, amount) {
  const towards = amount < 0 ? 0 : 255;
  const mix = Math.abs(amount);
  return (
    "#" +
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .map((v) => Math.round(v + (towards - v) * mix))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
/**
 * A few brand colours land in the band where neither white nor near-black
 * text quite clears WCAG AA on them. Rather than pick a different colour, the
 * bar takes the smallest step towards black or white that makes its own title
 * readable — the Tron is still the Tron's pink.
 */
function readable(colour) {
  if (legible(colour)) return colour;
  for (let step = 0.02; step <= 0.5; step += 0.02)
    for (const shifted of [shade(colour, -step), shade(colour, step)])
      if (legible(shifted)) return shifted;
  return colour;
}
/** A venue with no colour anywhere is still a lane, so nothing goes unpainted. */
function laneColour(venue, index) {
  return readable(
    VENUE_COLOURS[venue.id] || RESERVE[index % RESERVE.length],
  );
}
function checkPalette() {
  const weak = Object.entries(VENUE_COLOURS)
    .map(([id, colour]) => [id, readable(colour)])
    .filter(([, colour]) => !legible(colour));
  if (weak.length) {
    console.error(
      `\n\u2717 Venue colours no title can be read on: ${weak
        .map(([id, colour]) => `${id} (${colour})`)
        .join(", ")}\n`,
    );
    process.exit(1);
  }
}
checkPalette();
const DOW = ["M", "T", "W", "T", "F", "S", "S"];
const monthName = (key) =>
  new Date(key + "-01T12:00:00Z").toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    month: "long",
    year: "numeric",
  });
const timeline = buildTimeline(events, venues, { today });
/** What the hover card needs, and nothing else — the chart already carries
    152 links, so the preview payload stays lean. */
const preview = Object.fromEntries(
  timeline.lanes.flatMap((lane) =>
    lane.tracks.flat().map(({ event }) => [
      event.id,
      {
        title: event.title,
        venue: event.venue,
        dates: range(event),
        form: label(event.form),
        image: event.image || null,
        summary: (event.description || "").slice(0, 180),
        when: when(event),
        price: price(event),
        tickets: event.ticketUrl,
      },
    ]),
  ),
);
/**
 * A show on its lane. The bar is exactly as wide as the run, so the timeline
 * stays honest; the title sits on the bar when the run is long enough to hold
 * it and beside the bar when it is not, clipped to the gap before whatever
 * comes next.
 */
function laneItem(item) {
  const event = item.event;
  const inside = item.span >= 5;
  // The bar itself has room for a title and nothing else, so the times and the
  // price ride in the tooltip, where a mouse and a screen reader both find
  // them. The hover card repeats them for anyone who waits.
  const facts = [when(event), price(event)].filter(Boolean).join(" · ");
  const detail =
    `${event.title} — ${event.venue}, ${range(event)} · ${label(event.form)}` +
    (facts ? ` · ${facts}` : "");
  return `<a class="cal-item${inside ? " label-inside" : ""}${item.openStart ? " open-start" : ""}${item.openEnd ? " open-end" : ""}" href="${e(showPath(event))}" data-show="${e(event.id)}" style="--start:${item.start};--span:${item.span};--room:${item.room}" title="${e(detail)}"><span class="cal-bar" aria-hidden="true"></span><span class="cal-item-label">${e(event.title)}</span><span class="cal-item-dates">${e(range(event))} at ${e(event.venue)}${facts ? `, ${e(facts)}` : ""}</span></a>`;
}
function calendar(view) {
  const head = `<div class="cal-corner"><span class="eyebrow">Venue</span><span class="cal-corner-range">${e(date(view.from))} – ${e(date(view.to, true))}</span></div>
<div class="cal-head"><div class="cal-months">${view.months
    .map(
      (month) =>
        `<div class="cal-month" data-month="${month.key}" style="--start:${month.start};--span:${month.span}"><span>${e(monthName(month.key))}</span></div>`,
    )
    .join("")}</div>
<div class="cal-days">${view.days
    .map(
      (day) =>
        `<div class="cal-day${day.weekend ? " weekend" : ""}${day.today ? " is-today" : ""}"><span class="cal-dow">${DOW[day.weekday]}</span><span class="cal-dom">${day.date}</span></div>`,
    )
    .join("")}</div></div>`;
  const lanes = view.lanes
    .map((lane) => {
      const colour = laneColour(
        lane.venue,
        venues.findIndex((v) => v.id === lane.venue.id),
      );
      const paint = `--lane:${colour};--lane-ink:${barInk(colour)}`;
      // Where a venue's whole lane is one programme — every Òran Mór listing
      // is A Play, A Pie and A Pint — that is the name people know it by, so
      // it leads and the venue moves to the line beneath.
      const seasons = new Set(lane.tracks.flat().map((item) => item.event.season));
      const season = seasons.size === 1 ? [...seasons][0] : null;
      return `<div class="cal-lane-head" style="${paint}"><a href="/venues/${e(lane.venue.id)}.html"><span class="cal-lane-name">${e(season || lane.venue.name)}</span><span class="cal-lane-meta">${e(season ? lane.venue.name : lane.venue.area)} · ${lane.count} show${lane.count === 1 ? "" : "s"}</span></a></div>
<div class="cal-lane" style="${paint}">${lane.tracks.map((track) => `<div class="cal-track">${track.map(laneItem).join("")}</div>`).join("")}</div>`;
    })
    .join("");
  return `<div class="cal-scroll" id="cal-scroll" tabindex="0" role="region" aria-label="Timeline of shows by venue">
<div class="cal-grid" style="--cols:${view.columns};--today:${view.todayIndex}">${head}${lanes}<div class="cal-now" aria-hidden="true"></div></div></div>`;
}
write(
  "calendar.html",
  page(
    "Theatre calendar — what’s on, week by week",
    "A swim-lane timeline of Glasgow theatre. See which shows are running at every venue, how long each one runs, and jump straight to the venue.",
    "/calendar.html",
    `<section class="cal-section"><div class="container-wide">
<div class="cal-intro"><div><p class="eyebrow">Every stage, side by side</p><h1>The season<br>at a glance.</h1></div>
<p class="cal-lede">One lane per theatre, one column per day. Bars show how long a run lasts — scroll sideways to travel forward in time, and pick any show to see the venue behind it.</p></div>
<div class="cal-toolbar"><p class="cal-stat"><span class="live-dot" aria-hidden="true"></span><strong>${timeline.shows}</strong> runs across <strong>${timeline.lanes.length}</strong> venues, ${e(date(timeline.from))} to ${e(date(timeline.to, true))}</p>
<div class="cal-jump" id="cal-jump"><button class="cal-chip cal-chip-today" data-scroll-today>Today</button></div></div>
${calendar(timeline)}
<p class="cal-hint">Drag or scroll the chart in any direction; the arrow keys move a week at a time. Hover a show for a preview, or pick one to open its venue.</p>
<script>window.CAL_SHOWS = ${json(preview)};</script>
</div></section>
<section class="listing-invite"><div class="container"><div><p class="eyebrow">Not on the chart?</p><h2>Add your run<br>to the timeline.</h2><p>Listings are free for anyone putting on live work in Glasgow.</p></div><a class="btn" href="/submit.html">List your show ${arrow}</a></div></section>`,
    "calendar",
    [],
  ),
);
write(
  "venues.html",
  page(
    "Glasgow theatre venues",
    "Explore Glasgow’s theatre venues and find current shows.",
    "/venues.html",
    `<section class="page-hero container"><p class="eyebrow">Find your way to the stage</p><h1>Across the city.</h1><p>From the Gorbals to the West End. Grand auditoriums, intimate rooms and spaces to try something new.</p></section><section class="container venues-grid">${venues.map((v) => `<a class="venue-card" href="/venues/${v.id}.html"><span class="eyebrow">${e(v.area)}</span><h2>${e(v.name)}</h2><p>${e(v.description)}</p><span class="venue-card-footer">Explore venue ${arrow}</span></a>`).join("")}</section>`,
    "venues",
  ),
);
for (const venue of venues) {
  const list = events.filter((event) => event.venueId === venue.id);
  write(
    `venues/${venue.id}.html`,
    page(
      venue.name,
      venue.description,
      `/venues/${venue.id}.html`,
      `<section class="page-hero container"><a class="back-link" href="/venues.html">← All venues</a><p class="eyebrow">${e(venue.area)}</p><h1>${e(venue.name)}</h1><p>${e(venue.description)}</p><a class="btn" href="${e(venue.website)}">Visit venue website ${arrow}</a></section><section class="container venue-listings"><div class="section-heading"><h2>Coming up here.</h2><span id="results-count" role="status">${list.length} shows</span></div><div class="events-grid">${list.map(card).join("")}</div><div class="no-results" id="no-results" ${list.length ? "hidden" : ""}><p>No upcoming shows listed here yet. Check the venue’s website for its full programme.</p><a class="btn" href="${e(venue.website)}">See venue programme ${arrow}</a></div></section><script type="application/ld+json">${json(list.map(eventData))}</script>`,
      "venues",
      list,
    ),
  );
}
/* ------------------------------------------------------------ show pages */
/** Venue copy arrives as several lines in one string; keep them as lines. */
const paras = (text, className = "") =>
  String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p${className ? ` class="${className}"` : ""}>${e(line)}</p>`)
    .join("");
const weekday = (iso) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  });
/**
 * What a ticket costs, said three ways: the number a card can carry, the
 * venue's own wording underneath it, and whatever the venue added about fees
 * and offers. Where nobody published a price the panel says so plainly rather
 * than leaving a gap that reads as free.
 */
function ticketPanel(event) {
  const pricing = event.pricing;
  const cost = price(event);
  const source = concessionSource(pricing, scheme(event));
  const band =
    pricing && pricing.from != null && pricing.to != null && pricing.to > pricing.from
      ? `${money(pricing.from)} – ${money(pricing.to)}`
      : pricing && pricing.from != null && !pricing.free
        ? money(pricing.from)
        : null;
  return `<div class="ticket-panel">
<h2>Tickets</h2>
${cost ? `<p class="ticket-headline">${e(cost)}</p>` : `<p class="ticket-headline ticket-unknown">Prices not published</p>`}
${band && cost !== band && !(pricing && pricing.text) ? `<p class="ticket-band">Across the run: ${e(band)}</p>` : ""}
${pricing && pricing.text ? `<div class="ticket-quote"><p class="eyebrow">As ${e(event.venue)} lists it</p>${paras(pricing.text)}</div>` : ""}
${pricing && pricing.live ? `<p class="ticket-live">A live price: the cheapest seat still on sale when these listings were last refreshed, on ${e(date(londonDate(new Date(status.refreshedAt)), true))}. It moves as the run sells.</p>` : ""}
${source ? `<p class="ticket-source">The ${e(money(source.price))} is ${e(event.venue)}'s ${e(source.schemes.join(" and "))}, not a price set for this show. Eligibility is below.</p>` : ""}
${pricing && pricing.notes ? paras(pricing.notes, "ticket-note") : ""}
${!cost ? `<p class="ticket-note">${e(event.venue)} does not publish a price on its listing for this show. The booking page will have it.</p>` : ""}
<a class="btn" href="${e(event.ticketUrl)}">Book at ${e(event.venue)} ${arrow}</a>
</div>`;
}
/**
 * The venue's concession schemes, which are a property of the building rather
 * than of the show — the Citz's Gorbals and Low Income passes, Platform's
 * Local Links — with what each one costs and who can use it. Both of those
 * turn on where you live or what you earn rather than on any show, so they
 * belong on every one of that venue's pages.
 */
function concessionPanel(event) {
  const here = scheme(event);
  if (!here) return "";
  const row = (item) => `<div class="conc-row">
<div class="conc-name"><strong>${e(item.name)}</strong>${
    item.price != null
      ? `<span class="conc-price">${e(money(item.price))}</span>`
      : item.saving
        ? `<span class="conc-price conc-saving">${e(item.saving)}</span>`
        : ""
  }</div>
<p>${e(item.eligibility || "")}</p>${item.how ? `<p class="conc-how">${e(item.how)}</p>` : ""}</div>`;
  return `<div class="conc-panel">
<h2>Concessions at ${e(event.venue)}</h2>
${here.summary ? `<p class="conc-summary">${e(here.summary)}</p>` : ""}
${here.schemes && here.schemes.length ? here.schemes.map(row).join("") : `<p class="conc-summary">No venue-wide concession scheme is published. Any reduction for this show will be on the booking page.</p>`}
${
  here.offers && here.offers.length
    ? `<h3>Open to everyone</h3>${here.offers
        .map(
          (offer) =>
            `<div class="conc-row"><div class="conc-name"><strong>${e(offer.name)}</strong><span class="conc-price conc-saving">${e(offer.saving)}</span></div><p>${e(offer.detail || "")}</p></div>`,
        )
        .join("")}`
    : ""
}
${here.fees ? `<h3>Fees</h3><p class="conc-summary">${e(here.fees)}</p>` : ""}
<p class="conc-source">Read from <a href="${e(here.url)}">${e(event.venue)}'s own pages</a>, checked ${e(date(here.checkedAt, true))}. Always confirm with the venue before booking.</p>
</div>`;
}
/**
 * Every performance the venue lists, with its curtain time, whatever it has
 * laid on around it and — where the venue prices by the night — what the
 * cheapest seat costs. A source that only publishes the next few dates says
 * so rather than letting a pantomime look as though it closes in November.
 */
function performancePanel(event) {
  const list = event.performances || [];
  if (!list.length)
    return event.scheduleText
      ? `<div class="perf-panel"><h2>When</h2>${paras(event.scheduleText)}<p class="perf-note">${e(event.venue)} publishes its times as a description rather than a list of dates.</p></div>`
      : "";
  const row = (p) => `<tr>
<th scope="row"><span class="perf-dow">${e(weekday(p.date))}</span> ${e(date(p.date, p.date.slice(0, 4) !== event.date.slice(0, 4)))}</th>
<td class="perf-time">${p.time ? e(clockTime(p.time)) : "—"}</td>
<td class="perf-note-cell">${[p.note, ...(p.access || [])].filter(Boolean).map((n) => `<span class="perf-tag">${e(n)}</span>`).join("")}</td>
<td class="perf-price">${p.price != null ? e(money(p.price)) : ""}</td>
</tr>`;
  return `<div class="perf-panel"><h2>Performances</h2>
${event.scheduleText ? paras(event.scheduleText, "perf-lede") : ""}
<div class="perf-scroll"><table class="perf-table"><caption class="visually-hidden">Performance dates and times for ${e(event.title)}</caption>
<thead><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Notes</th><th scope="col">From</th></tr></thead>
<tbody>${list.map(row).join("")}</tbody></table></div>
${event.performancesPartial ? `<p class="perf-note">${e(event.venue)} publishes only the next few dates of a long run. This run continues to ${e(range(event).replace(/^.*– /, ""))} — see the venue for the rest.</p>` : ""}
</div>`;
}
function showPage(event) {
  const cost = price(event);
  const times = when(event);
  const facts = [
    ["Dates", range(event)],
    ["Times", times],
    ["Running time", durationLabel(event.duration)],
    ["Tickets", cost],
    ["Art form", label(event.form)],
  ].filter(([, value]) => value);
  return page(
    `${event.title} — ${event.venue}`,
    `${event.title} at ${event.venue}, ${range(event)}.${cost ? ` Tickets ${cost}.` : ""} Performance times, prices and concessions.`,
    showPath(event),
    `<section class="show-hero"><div class="container">
<a class="back-link" href="/">← What's on</a>
<div class="show-hero-grid">
<div class="show-hero-text"><p class="eyebrow"><a href="/venues/${e(event.venueId)}.html">${e(event.season || event.venue)}</a> · ${e(label(event.form))}</p>
<h1>${e(event.title)}</h1>
<dl class="show-facts">${facts.map(([term, value]) => `<div><dt>${e(term)}</dt><dd>${e(value)}</dd></div>`).join("")}</dl>
<a class="btn" href="${e(event.ticketUrl)}">Book at ${e(event.venue)} ${arrow}</a></div>
${event.image ? `<figure class="show-hero-image"><img src="${e(event.image)}" alt="${e(event.imageAlt || event.title)}" width="1100" height="688">${event.imageCredit ? `<figcaption>${e(event.imageCredit)}</figcaption>` : ""}</figure>` : ""}
</div></div></section>
<section class="show-body"><div class="container show-columns">
<div class="show-main"><h2>About the show</h2><p class="show-description">${e(event.description)}</p>
${event.producer ? `<p class="show-producer">Produced by ${e(event.producer)}</p>` : ""}
${event.accessibility ? `<div class="accessibility show-access"><span aria-hidden="true">✳</span> ${e(event.accessibility)}</div>` : ""}
${performancePanel(event)}
</div>
<aside class="show-aside">${ticketPanel(event)}${concessionPanel(event)}</aside>
</div></section>
<script type="application/ld+json">${json(eventData(event))}</script>`,
    "events",
    [event],
  );
}
for (const event of events) write(`shows/${event.id}.html`, showPage(event));
write(
  "about.html",
  page(
    "About this independent theatre guide",
    "An independent guide to theatre, dance and performance in Glasgow.",
    "/about.html",
    `<section class="page-hero container"><p class="eyebrow">Independent. Local. Live.</p><h1>For a love<br>of live theatre.</h1><p>Glasgow Theatre helps you find what’s on across the city, from established stages to independent performance spaces.</p></section><section class="prose container"><h2>A place to find your next show</h2><p>Browse productions by venue, date or art form, then book directly with the venue. Listings are free, and this guide is independent of the theatres it covers.</p><h2>About the listings</h2><p>We gather listings from venue programmes and accept submissions from companies and artists. This is a selection of what’s on, rather than a complete programme for every venue. Check the booking page for the latest performance times, prices, availability and access arrangements.</p><h2>Something missing or incorrect?</h2><p><a href="/submit.html">Send us a listing</a> or email <a href="mailto:info@glasgowtheatre.com">info@glasgowtheatre.com</a> with a correction.</p><h2>Who runs this</h2><p>Glasgow Theatre is maintained by David Hewitson.</p></section>`,
    "about",
  ),
);
write(
  "submit.html",
  page(
    "List your show",
    "Submit your Glasgow theatre, dance or performance listing for free.",
    "/submit.html",
    `<section class="page-hero container"><p class="eyebrow">A stage for your show</p><h1>Tell Glasgow.</h1><p>Putting on theatre, dance or live performance in Glasgow? Send us the details. It’s free to be listed.</p></section><section class="prose container"><h2>Send us your listing</h2><ul><li>Show title and company name</li><li>Venue, dates and performance times</li><li>A short description and art form</li><li>A direct booking link</li><li>A production image, with photo credit and permission to use it</li><li>Access information, including BSL, captioned, relaxed or audio-described performances</li></ul><div class="submit-box"><p>Ready when you are.</p><a class="btn" href="mailto:info@glasgowtheatre.com?subject=Show%20listing">Email your listing ${arrow}</a><a href="mailto:info@glasgowtheatre.com">info@glasgowtheatre.com</a></div></section>`,
    "submit",
  ),
);
const paths = [
  "/",
  "/calendar.html",
  "/venues.html",
  "/about.html",
  "/submit.html",
  ...venues.map((v) => `/venues/${v.id}.html`),
  ...events.map(showPath),
];
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`).join("")}</urlset>`,
);
// The published feed is what yesterday's build left behind, so the daily
// report can diff against it without storing state anywhere.
write("data/events.json", JSON.stringify(events, null, 2) + "\n");
// Lets you check from outside whether the unattended build actually ran, and
// whether it reached the venues or fell back to the last saved listings.
write(
  "data/status.json",
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      refreshedAt: status.refreshedAt,
      upcoming: events.length,
      venues: venueCount,
      sources: status.counts,
      retainedVenues: status.retainedVenues,
      ...(tagUsage ? { tagging: tagUsage } : {}),
      ...(ticketUsage ? { tickets: ticketUsage } : {}),
      ...(status.failures && Object.keys(status.failures).length
        ? { failures: status.failures }
        : {}),
      ...(status.canaries && Object.keys(status.canaries).length
        ? { canaries: status.canaries }
        : {}),
    },
    null,
    2,
  ) + "\n",
);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write("CNAME", "glasgowtheatre.com\n");
write(".nojekyll", "");
write(
  "favicon.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#303fce"/><text x="32" y="45" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="42" fill="#e3ddfa">G</text></svg>',
);
for (const dir of ["css", "js", "images", "fonts"])
  fs.cpSync(path.join(__dirname, "src", dir), path.join(DIST, dir), {
    recursive: true,
  });
console.log(
  `Built ${paths.length} pages with ${events.length} upcoming shows. Listings last refreshed ${status.refreshedAt}.`,
);
