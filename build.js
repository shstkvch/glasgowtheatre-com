const fs = require("fs");
const path = require("path");
const {
  londonDate,
  filterEvents,
  countArtForms,
  mergeListings,
} = require("./src/js/listings");
const { FORMS, fallbackForm, combine } = require("./scripts/art-forms");
const DIST = path.join(__dirname, "dist");
const SITE = "https://glasgowtheatre.com";
const today = londonDate();
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "data", name), "utf8"));
const venues = read("venues.json");
const images = read("image-cache.json");
const status = read("refresh-status.json");
// Absent when tagging has never run; the daily report treats that as no spend.
const tagUsage = (() => {
  try {
    return read("tag-usage.json");
  } catch {
    return null;
  }
})();
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
    startDate: event.date,
    endDate: event.endDate || event.date,
    url: event.ticketUrl,
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
    ["venues", "/venues.html", "Venues"],
    ["about", "/about.html", "About"],
    ["submit", "/submit.html", "List your show ↗"],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} | Glasgow Theatre</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${SITE}${url}">
<meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${SITE}${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="Glasgow Theatre"><meta property="og:image" content="${SITE}/images/thrice.webp"><meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#303fce">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/style.css">
<script defer src="/js/listings.js"></script><script defer src="/js/main.js"></script></head><body>
<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="container header-inner"><a class="brand" href="/" aria-label="Glasgow Theatre home">GLASGOW<span>THEATRE<span class="brand-dot">●</span></span></a>
<nav aria-label="Main navigation">${nav.map(([key, href, text]) => `<a href="${href}"${active === key ? ' aria-current="page"' : ""}>${text}</a>`).join("")}</nav></div></header>
<main id="main">${body}</main>
<footer class="site-footer"><div class="container"><div class="footer-top"><div><a class="brand" href="/">GLASGOW<span>THEATRE<span class="brand-dot">●</span></span></a><p>Big stages. Small rooms. A whole city of stories.</p></div><div><p class="eyebrow">Made for the audience</p><a href="/about.html">About this independent guide ${arrow}</a><a href="/submit.html">Get your show listed ${arrow}</a><a href="mailto:info@glasgowtheatre.com">Get in touch ${arrow}</a></div></div><div class="footer-bottom"><span>© ${today.slice(0, 4)} Glasgow Theatre</span><span>Listings refreshed ${date(londonDate(new Date(status.refreshedAt)), true)} · Always check details with the venue.</span></div></div></footer>
<script type="application/ld+json">${json({ "@context": "https://schema.org", "@type": "WebSite", name: "Glasgow Theatre", url: SITE })}</script>${active === "events" ? `<script type="application/ld+json">${json(pageEvents.map(eventData))}</script>` : ""}
<script>window.EVENTS = ${json(pageEvents)};</script></body></html>`;
}
function card(event) {
  return `<article class="event-card" data-id="${e(event.id)}" data-date="${e(event.date)}" data-end-date="${e(event.endDate || event.date)}">
<div class="event-card-image${event.image ? "" : " image-unavailable"}"><a class="event-card-thumb" href="${e(event.ticketUrl)}" tabindex="-1"><div class="image-fallback" aria-hidden="true"><span>ON STAGE AT</span><strong>${e(event.venue)}</strong></div>${event.image ? `<img src="${e(event.image)}" alt="${e(event.imageAlt || event.title)}" width="1100" height="688" loading="lazy">` : ""}</a><span class="date-stamp">${e(range(event))}</span></div>
<div class="event-card-body"><div class="card-topline"><a href="/venues/${e(event.venueId)}.html">${e(event.season || event.venue)}</a><span>${e(label(event.form))}</span></div>
<h3><a href="${e(event.ticketUrl)}">${e(event.title)}</a></h3><p class="event-description">${e(event.description)}</p>
${event.accessibility ? `<p class="accessibility"><span aria-hidden="true">✳</span> ${e(event.accessibility)}</p>` : ""}
<div class="event-card-footer"><span>${event.time ? e(time(event.time)) : "Times & tickets at venue"}</span><a class="ticket-link" href="${e(event.ticketUrl)}" aria-label="Tickets for ${e(event.title)}">Tickets ${arrow}</a></div></div></article>`;
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
  "/venues.html",
  "/about.html",
  "/submit.html",
  ...venues.map((v) => `/venues/${v.id}.html`),
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
