#!/usr/bin/env node

/**
 * The Monday carousel: what's on in the coming week, as ten slides.
 *
 * Writes dist/social/week.html — a deck of 1080×1350 slides built from the
 * same listings the site publishes, using the site's own fonts and colours.
 * The page is the source of the images rather than a preview of them: the
 * publisher screenshots each `.slide` and posts the results.
 *
 * Generation runs on every build, not only on Mondays, so the coming week's
 * post is sitting at a URL you can open any day and look at long before
 * anything is published. Nothing here talks to Instagram.
 *
 * Usage:
 *   node scripts/build-social.js            # the coming Monday's week
 *   node scripts/build-social.js --week 2026-09-14
 */

const fs = require("fs");
const path = require("path");

const { cropFor } = require("./read-artwork");
const { FORMS, fallbackForm } = require("./art-forms");

const DIST = path.join(__dirname, "..", "dist", "social");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", name), "utf8"));

/**
 * Venue colours, as the calendar draws them. Copied from build.js for now;
 * when this moves into the daily build the map wants lifting into a module
 * both can require, because two copies will drift the first time a venue
 * rebrands.
 */
const VENUE_COLOURS = {
  citizens: "#111111",
  tron: "#e91d75",
  tramway: "#4a4f57",
  "oran-mor": "#e74825",
  "glad-cafe": "#f0bd0f",
  platform: "#6626ff",
  "southside-fringe": "#0051c3",
  cottiers: "#314e42",
  kings: "#5a00ff",
  "theatre-royal": "#d0202d",
  pavilion: "#256d58",
  "old-hairdressers": "#6f7f3a",
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
/** Whichever of the two house inks a title on this colour can be read in. */
const barInk = (colour) =>
  contrast(colour, "#ffffff") >= contrast(colour, "#20202c")
    ? "#ffffff"
    : "#20202c";

/* ------------------------------------------------------------ the window */

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const day = (s) => new Date(s + "T12:00:00Z");

/** The Monday of the week a post published on `from` would be covering. */
function weekOf(from) {
  const d = day(from);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return iso(new Date(d.getTime() - back * DAY));
}

/** The coming Monday — what next week's post covers, seen from today. */
function nextWeek(from) {
  const monday = day(weekOf(from));
  return from === iso(monday) ? from : iso(new Date(monday.getTime() + 7 * DAY));
}

/* ---------------------------------------------------------- what goes in */

/**
 * The order the week's events are offered in.
 *
 * Nothing is excluded any more: a building tour and a drama workshop are
 * things people go to, and a thin week needs them. They are ranked last
 * instead, so they only reach a slide once the plays have had theirs.
 *
 * The spine of this is a house judgement — plays, then musicals, then opera,
 * then poetry, then comedy, then workshops, then community events. The forms
 * the vocabulary carries but that list does not name are slotted beside their
 * nearest named neighbour: dance, physical theatre and pantomime with the
 * staged work above poetry; cabaret with comedy; music and talks below it.
 */
const FORM_ORDER = [
  "play",
  "musical",
  "opera",
  "dance",
  "physical-theatre",
  "pantomime",
  "spoken-word",
  "cabaret",
  "stand-up",
  "music",
  "talk",
  "workshop",
  "tour",
  "community-event",
];

/** The art form, as the tagger left it on the listing. */
const formOf = (event) =>
  Object.hasOwn(FORMS, event.form || "")
    ? event.form
    : (event.tags || []).find((tag) => Object.hasOwn(FORMS, tag)) || fallbackForm(event);

/** Where a listing's form sits in the running order; unknown forms go last. */
function formRank(event) {
  const at = FORM_ORDER.indexOf(formOf(event));
  return at === -1 ? FORM_ORDER.length : at;
}

/**
 * The week's events, best first.
 *
 * Art form leads, because that is the running order the site keeps. Within a
 * form, what opens this week comes before a run already a fortnight old, and
 * then it is simply date order.
 *
 * Across all of that, one event per venue before any venue gets a second: a
 * week where the Citz has three things on should not read as a Citz advert,
 * and with nothing filtered out any more a venue that lists its tours could
 * otherwise fill the grid on its own.
 */
function selectShows(events, monday, limit = 9) {
  const sunday = iso(new Date(day(monday).getTime() + 6 * DAY));
  const inWeek = events
    .filter((e) => (e.date || "") <= sunday && (e.endDate || e.date) >= monday)
    .map((e) => ({ ...e, opens: e.date >= monday && e.date <= sunday }));

  const rank = (a, b) =>
    formRank(a) - formRank(b) || b.opens - a.opens || a.date.localeCompare(b.date);
  const seen = new Set();
  const first = [];
  const rest = [];
  for (const event of [...inWeek].sort(rank)) {
    (seen.has(event.venueId) ? rest : first).push(event);
    seen.add(event.venueId);
  }
  const chosen = [...first, ...rest.sort(rank)].slice(0, limit);
  return {
    chosen,
    all: inWeek,
    // What the cover claims is the whole week, not the nine that fitted.
    tally: { events: inWeek.length, venues: new Set(inWeek.map((e) => e.venueId)).size },
  };
}

/* ------------------------------------------------------------- the words */

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const DAYS = "Mon Tue Wed Thu Fri Sat Sun".split(" ");
const dayName = (s) => DAYS[(day(s).getUTCDay() + 6) % 7];
const dayNum = (s) => day(s).getUTCDate();
const month = (s) => MONTHS[day(s).getUTCMonth()];

/** "14–20 September", collapsing the month where both ends share one. */
function rangeLabel(from, to) {
  const a = day(from);
  const b = day(to);
  const full = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${full[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
}

/**
 * What a slide says about when, in the fewest words that stay true. A show
 * opening inside the week leads with the day it opens; one already running
 * says how long is left, because that is the part a reader can still act on.
 */
function whenLabel(event, monday, sunday) {
  const end = event.endDate || event.date;
  const at = (d) => `${dayName(d)} ${dayNum(d)} ${month(d)}`;
  if (end === event.date) return at(event.date);
  if (event.opens) return `Opens ${at(event.date)}, until ${at(end)}`;
  return `On now, until ${at(end)}`;
}

/**
 * A show's run, both ends of it.
 *
 * The week is only a window on a run. Antigone opens inside it and plays to
 * 10 October; 1984 opened in August and closes after it. Naming one end and
 * not the other made a month-long production read as a single night and a run
 * about to close read as open-ended, so both ends are always given.
 *
 * A date inside the week is the day and the number, because the masthead
 * already says which month that is. A date outside the week carries its month
 * as well, and its year where the run crosses into the next one.
 */
function runLabel(show, monday, sunday) {
  const end = show.endDate || show.date;
  const stamp = (d) => {
    const inWeek = d >= monday && d <= sunday;
    const year =
      day(d).getUTCFullYear() === day(monday).getUTCFullYear()
        ? ""
        : ` ${day(d).getUTCFullYear()}`;
    return `${dayName(d)} ${dayNum(d)}${inWeek ? "" : ` ${month(d)}${year}`}`;
  };
  return end === show.date
    ? stamp(show.date)
    : `${stamp(show.date)} – ${stamp(end)}`;
}

/**
 * "From £14", or nothing at all when nobody published a price.
 *
 * Only `free` means free. Cottiers' box office emits "Standard Price : 0.00"
 * for a talk you pay for, the same way the Tron's reads "From £0.00", and a
 * zero read out of a placeholder is a price nobody published rather than a
 * free ticket. Saying so costs a line; saying "Free" is a promise the venue
 * has not made.
 */
function priceLabel(pricing) {
  if (!pricing) return null;
  if (pricing.free) return "Free";
  if (pricing.payWhatYouLike) return "Pay what you like";
  if (!pricing.from) return null;
  // £23.5 is what the number says and £23.50 is what a price looks like.
  const money = (n) => `£${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const from = `From ${money(pricing.from)}`;
  return pricing.concession != null
    ? `${from} (conc. ${money(pricing.concession)})`
    : from;
}

/** "7.30pm", from the 24-hour time the venue published. */
function timeLabel(time) {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 || 12;
  return m ? `${hour}.${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

/**
 * What a bar can call a show. A comedian's tour title is the comedian's name
 * and then a joke — "Gary Delaney: Gary On Laughing" — and on a bar a seventh
 * of the width wide, the name is the part that sells the ticket. The slide
 * for that show still carries the title in full.
 */
function shortTitle(title) {
  if (title.length <= 26) return title;
  const cut = title.match(/^(.+?)\s*(?:[-–—]|:)\s+/);
  return cut && cut[1].length >= 6 ? cut[1] : title;
}

const label = (form) =>
  (form || "")
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

const e = (v) =>
  String(v ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/* ----------------------------------------------------------- the run bar */

/**
 * Where a run sits on the week's seven columns, and whether it is cut off.
 *
 * The site's calendar draws a run at exactly its own length and gives a bar
 * that leaves the window a flat end rather than a rounded one, so a bar never
 * claims to begin or finish where it does not. Seven days is a short window
 * and most runs are longer, so the flat ends do a lot of work here.
 */
function runBar(event, monday, sunday) {
  const start = event.date < monday ? monday : event.date;
  const end = (event.endDate || event.date) > sunday ? sunday : event.endDate || event.date;
  const from = Math.round((day(start) - day(monday)) / DAY);
  const to = Math.round((day(end) - day(monday)) / DAY);
  return {
    from,
    span: to - from + 1,
    openLeft: event.date < monday,
    openRight: (event.endDate || event.date) > sunday,
  };
}

/* --------------------------------------------------------------- slides */

/** The site's own logotype, stacked over two lines with the blue full stop. */
const logotype = () =>
  `<span class="brand">GLASGOW<span>THEATRE<span class="brand-dot">●</span></span></span>`;

/**
 * How the cover carries the name of the site.
 *
 *   masthead  logotype above the headline, both left-aligned
 *   lockup    logotype and the dates on one line over a rule
 *   hero      the logotype is the headline; the week is the line beneath
 *   signoff   headline as it was, logotype signing off at the foot
 *
 * `hero` gives the timeline the most room, because it spends one type block
 * where the others spend two.
 */
const COVERS = ["masthead", "lockup", "hero", "signoff"];

/**
 * Covers that lead with the artwork rather than with the week's shape.
 *
 *   wall   nine thumbnails, three by three, under the masthead
 *   lead   one show at cover size, four more along the foot
 *   six    six thumbnails, two by three, each on its venue's colour
 *
 * The swim-lane cover says what the week looks like; these say what is in it.
 * A poster wall is the form a theatre's own frontage already takes, which is
 * why the grid variants sit the artwork edge to edge with no gutter.
 */
const PICTURE_COVERS = ["wall", "lead", "six"];

/** One show as a thumbnail: its artwork, then its name on its venue's colour. */
function cell(show, monday, sunday, extra = "") {
  const art = show.image
    ? `<img src="..${e(show.image)}" alt="${e(show.imageAlt || show.title)}"${
        show.crop.position ? ` style="object-position: 50% ${show.crop.position}"` : ""
      }>`
    : `<span class="cell-none">${e(show.venue)}</span>`;
  return `<li class="cell ${extra}" style="--bar:${show.colour};--on-bar:${barInk(show.colour)}">
  <div class="cell-art${show.crop.fit === "contain" ? " whole" : ""}">${art}</div>
  <div class="cell-cap">
    <p class="cell-when">${e(runLabel(show, monday, sunday))}</p>
    <h3>${e(smart(shortTitle(show.title)))}</h3>
    <p class="cell-venue">${e(show.venue)}</p>
  </div>
</li>`;
}

/**
 * A cover that leads with the artwork.
 *
 * The masthead is a block of paper sitting on the pictures rather than a line
 * above them, because a grid of nine posters with a caption over it is what a
 * theatre's frontage looks like and a centred headline on white is not.
 */
function pictureCover(shows, monday, sunday, tally, variant, id) {
  const dates = rangeLabel(monday, sunday);
  const masthead = `<header class="pic-head">
    ${logotype()}
    <p class="pic-dates">What’s on<span>${e(dates)}</span></p>
  </header>`;

  if (variant === "lead") {
    const [first, ...rest] = shows;
    const four = rest.slice(0, 4);
    return `<section class="slide cover pic pic-lead" id="${id}" data-name="01-cover-lead">
  <div class="lead-art${first.crop.fit === "contain" ? " whole" : ""}" style="--bar:${first.colour};--on-bar:${barInk(first.colour)}">
    ${
      first.image
        ? `<img src="..${e(first.image)}" alt="${e(first.imageAlt || first.title)}"${
            first.crop.position ? ` style="object-position: 50% ${first.crop.position}"` : ""
          }>`
        : ""
    }
    ${masthead}
    <div class="lead-cap">
      <p class="lead-flag">${e(flagLabel(first))}</p>
      <h2>${e(first.title)}</h2>
      <p class="lead-venue">${e(first.venue)} · ${e(runLabel(first, monday, sunday))}</p>
    </div>
  </div>
  <div class="lead-more">
    <p class="more-label">Also on this week</p>
    <ol class="strip-cells">${four.map((show) => cell(show, monday, sunday)).join("")}</ol>
    <p class="pic-foot"><strong>${tally.events}</strong> events · <strong>${tally.venues}</strong> venues · glasgowtheatre.com</p>
  </div>
</section>`;
  }

  const count = variant === "six" ? 6 : 9;
  const shown = shows.slice(0, count);
  const held = tally.events - shown.length;
  // A thin week is the case to get right, not the exception: one listing gets
  // the whole slide, two share it as bands, and only at four does the grid
  // become two columns. Six cells in a week with two would leave four holes.
  return `<section class="slide cover pic pic-${variant}" id="${id}" data-name="01-cover-${variant}">
  ${masthead}
  <ol class="cells cells-${shown.length}">${shown.map((show) => cell(show, monday, sunday)).join("")}</ol>
  <footer class="pic-tally">
    <p><strong>${tally.events}</strong> event${tally.events === 1 ? "" : "s"} · <strong>${tally.venues}</strong> venue${
      tally.venues === 1 ? "" : "s"
    }${held ? ` · ${held} more on the site` : ""}</p>
    <p class="pic-url">glasgowtheatre.com</p>
  </footer>
</section>`;
}

function coverSlide(shows, monday, sunday, tally, variant = "six", id = "slide-1") {
  if (PICTURE_COVERS.includes(variant))
    return pictureCover(shows, monday, sunday, tally, variant, id);

  const bars = shows
    .map((show) => {
      const bar = runBar(show, monday, sunday);
      const colour = show.colour;
      // A one-night show is a seventh of the width, which no title fits in.
      // The bar keeps its true length and the title steps outside it — to the
      // right where there is room, and to the left when the run is late in
      // the week and there is not.
      const side = bar.span >= 3 ? "in" : bar.from + bar.span <= 4 ? "right" : "left";
      return `<li class="track">
  <span class="bar side-${side}${bar.openLeft ? " open-left" : ""}${bar.openRight ? " open-right" : ""}"
        style="--from:${bar.from};--span:${bar.span};--bar:${colour};--on-bar:${barInk(colour)}">
    <span class="bar-title">${e(shortTitle(show.title))}</span>
  </span>
</li>`;
    })
    .join("\n");

  const dates = rangeLabel(monday, sunday);
  const head = {
    masthead: `<header class="cover-head">
    ${logotype()}
    <h1>What’s on.</h1>
    <p class="dateline">${e(dates)}</p>
  </header>`,
    lockup: `<header class="cover-head lockup">
    <div class="lockup-row">${logotype()}<span class="lockup-date">${e(dates)}</span></div>
    <h1>What’s<br>on.</h1>
  </header>`,
    hero: `<header class="cover-head hero">
    ${logotype()}
    <p class="dateline">What’s on · ${e(dates)}</p>
  </header>`,
    signoff: `<header class="cover-head">
    <p class="eyebrow">Week of ${e(dates)}</p>
    <h1>What’s<br>on.</h1>
  </header>`,
  }[variant];

  const foot =
    variant === "signoff"
      ? `<footer class="cover-foot signoff">
    <p class="tally"><strong>${tally.events}</strong> events · <strong>${tally.venues}</strong> venues</p>
    ${logotype()}
  </footer>`
      : `<footer class="cover-foot">
    <p class="tally"><strong>${tally.events}</strong> events · <strong>${tally.venues}</strong> venues</p>
    <p class="wordmark">glasgowtheatre.com</p>
  </footer>`;

  return `<section class="slide cover cover-${variant}" id="${id}" data-name="01-cover-${variant}">
  ${head}
  <div class="week-grid">
    <ol class="days">${[...Array(7)]
      .map((_, i) => {
        const d = iso(new Date(day(monday).getTime() + i * DAY));
        return `<li><span class="day-name">${dayName(d)[0]}</span><span class="day-num">${dayNum(d)}</span></li>`;
      })
      .join("")}</ol>
    <ol class="tracks">${bars}</ol>
  </div>
  ${foot}
</section>`;
}

/**
 * The band across the artwork. A single night is not "opening this week" —
 * it opens and closes on the same evening, and saying so is the thing most
 * likely to get someone to book before it goes.
 */
/**
 * One sentence about the show, in the venue's own words.
 *
 * These are meta descriptions and longest-paragraphs scraped off venue sites,
 * not copy written to be quoted, so three things have to happen before one is
 * fit to put on a slide.
 *
 * Age guidance and running times are published as part of the blurb and come
 * first — Antigone's opens "Recommended Age Guide 14+ The battle has been
 * won" — and a naive first sentence publishes the age rating as the hook.
 *
 * Some listings have no blurb at all, only a line assembled from the title and
 * the building: "BAKED BEANS ON THE DOORSTEP: SEPTEMBER at The Old
 * Hairdressers, Glasgow." Printing that says the name twice and nothing else,
 * so a sentence that is mostly the title and the venue is treated as absent.
 *
 * Nothing is rewritten. A sentence too long for the slide is cut at a clause
 * and marked with an ellipsis, so what is left is still the venue's own words.
 */
const BLURB_MAX = 150;

function blurb(event) {
  const text = smart(event.description || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Front matter the venue put before the writing.
  const body = text
    .replace(/^(recommended\s+)?age (guide|guidance|recommendation)\b[^.]*?\d+\+\s*/i, "")
    .replace(/^(running time|please note|content warning)\b[^.]*?[.]\s*/i, "")
    .trim();

  const first = (body.match(/^.*?[.!?](?=\s|$)/) || [body])[0].trim();
  if (first.length < 30) return null;

  // A sentence that is the title and the venue over again is not a blurb.
  const words = (s) => new Set(s.toLowerCase().match(/[a-z']{4,}/g) || []);
  const known = new Set([
    ...words(event.title || ""),
    ...words(event.venue || ""),
    "glasgow",
  ]);
  const own = [...words(first)].filter((w) => !known.has(w));
  if (own.length < 4) return null;

  if (first.length <= BLURB_MAX) return first;
  const cut = first.slice(0, BLURB_MAX);
  const clause = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "), cut.lastIndexOf(" — "));
  const at = clause > BLURB_MAX * 0.5 ? clause : cut.lastIndexOf(" ");
  return first.slice(0, at).replace(/[,;:]$/, "") + "…";
}

/**
 * A safe starting size for a title, set on the element at build time.
 *
 * The real size is measured in the browser, but the measurement needs a
 * browser: embed this markup anywhere the script does not run and every title
 * sits at the base size and overruns the date. These are deliberately a step
 * smaller than the measured fit for the same lengths, so a page without the
 * script is a little conservative rather than broken, and the script grows it
 * back to the size the panel actually has room for.
 */
function titleSize(title) {
  const n = (title || "").length;
  if (n <= 22) return 96;
  if (n <= 46) return 76;
  if (n <= 70) return 62;
  return 52;
}

/**
 * Straight marks are a database artefact. The site sets curly ones, and a
 * slide carrying "Don't" beside a masthead reading "What's on" looks like two
 * different publications.
 */
const smart = (v) =>
  String(v ?? "")
    .replace(/'/g, "\u2019")
    .replace(/"([^"]*)"/g, "\u201c$1\u201d")
    .replace(/ - /g, " \u2013 ");

/**
 * The artist, where the listing's title is really two things joined.
 *
 * "Russell Howard – Don't Tell The Algorithm" is a name and a tour name in one
 * database field, and set as one string it breaks across a line with the dash
 * stranded. Split, the name leads and the tour gets to be the title.
 */
function titleParts(title) {
  const t = smart(title);
  const m = t.length > 26 && t.match(/^(.{6,42}?)\s*[\u2013\u2014:]\s+(.+)$/);
  return m ? { lead: m[1], main: m[2] } : { lead: null, main: t };
}

/**
 * The eyebrow, where there is something to say.
 *
 * It used to carry "One night only" on five of nine slides, which made it the
 * default state and therefore no signal at all — and the date line already
 * says "Thu 17 Sep" with nothing after it. Only two things are worth a label:
 * a run that starts this week, and one that finishes in it.
 */
function flagLabel(show, monday, sunday) {
  const end = show.endDate || show.date;
  if (end === show.date) return null;
  if (show.opens) return "Opening this week";
  return end <= sunday ? "Last chance" : null;
}

function showSlide(show, index, monday, sunday) {
  const colour = show.colour;
  const bar = runBar(show, monday, sunday);
  const time = timeLabel(show.time);
  const cost = priceLabel(show.pricing);
  const facts = [time, cost].filter(Boolean);

  const flag = flagLabel(show, monday, sunday);
  const { lead, main } = titleParts(show.title);
  return `<section class="slide show" id="slide-${index + 1}" data-name="${String(index + 1).padStart(2, "0")}-${e(show.id)}" style="--bar:${colour};--title:${main.length <= 22 ? 104 : 76}px">
  <div class="art${show.crop.fit === "contain" ? " whole" : ""}">${
    show.image
      ? `<img src="..${e(show.image)}" alt="${e(show.imageAlt || show.title)}"${
          show.crop.position ? ` style="object-position: 50% ${show.crop.position}"` : ""
        }>`
      : `<div class="art-fallback"><strong>${e(show.venue)}</strong></div>`
  }</div>
  <div class="panel">
    ${flag ? `<p class="eyebrow-row"><span class="eyebrow-bar"></span>${e(flag)}</p>` : ""}
    <p class="venue-row"><span class="venue-dot"></span>${e(show.venue)}</p>
    ${lead ? `<p class="lead-name">${e(lead)}</p>` : ""}
    <h2>${e(main)}</h2>
    ${show.blurb ? `<p class="blurb">${e(show.blurb)}</p>` : ""}
  </div>
  <div class="ticket">
    <p class="when">${e(whenLabel(show, monday, sunday))}</p>
    <p class="cost">${
      facts.length
        ? facts.map((f) => `<span>${e(f)}</span>`).join("")
        : `<span class="soft">Prices at the venue</span>`
    }</p>
  </div>
</section>`;
}

/* ------------------------------------------------------------ the page */

function page(slides, monday, sunday) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>What's on ${rangeLabel(monday, sunday)} — carousel</title>
<style>
@font-face { font-family: "Barlow Condensed"; font-weight: 700; src: url(../fonts/font-0.ttf) format("truetype"); }
@font-face { font-family: "Barlow Condensed"; font-weight: 800; src: url(../fonts/font-1.ttf) format("truetype"); }
@font-face { font-family: "DM Sans"; font-weight: 400; src: url(../fonts/font-2.ttf) format("truetype"); }
@font-face { font-family: "DM Sans"; font-weight: 500; src: url(../fonts/font-3.ttf) format("truetype"); }
@font-face { font-family: "DM Sans"; font-weight: 600; src: url(../fonts/font-4.ttf) format("truetype"); }
@font-face { font-family: "DM Sans"; font-weight: 700; src: url(../fonts/font-5.ttf) format("truetype"); }

:root {
  --paper: #f4f3f8;
  --lilac: #e3ddfa;
  --blue: #303fce;
  --ink: #20202c;
  --muted: #595867;
  --peach: #f5ab76;
  --line: #d3d1df;
  --display: "Barlow Condensed", "Arial Narrow", sans-serif;
  --body: "DM Sans", Arial, sans-serif;
  --pad: 76px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #16161e; font-family: var(--body); color: var(--paper); }

/* The deck is shown at a third size so a whole carousel fits on a screen.
   ?raw=1 drops the scaling, which is how the slides are screenshotted. */
.deck { display: flex; flex-wrap: wrap; gap: 40px; padding: 40px; align-items: flex-start; }
body.preview .deck { zoom: 0.34; }
.plate { position: relative; }
.plate > figcaption {
  position: absolute; top: -30px; left: 0;
  font: 600 22px/1 var(--body); color: #8b8aa0; letter-spacing: 0.04em;
}
body:not(.preview) .plate > figcaption { display: none; }

.slide {
  width: 1080px; height: 1350px; overflow: hidden; position: relative;
  background: var(--paper); color: var(--ink);
  display: flex; flex-direction: column;
}

/* ------------------------------------------------------------ the cover */

.cover { padding: var(--pad); justify-content: space-between; }
.cover .eyebrow {
  font: 600 25px/1 var(--body); letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--blue); margin-bottom: 26px;
}
.cover h1 {
  font: 800 168px/0.84 var(--display); letter-spacing: -0.025em; color: var(--ink);
}

/* The site's logotype, at the size each cover wants it. Two stacked lines of
   Barlow Condensed with the blue full stop, exactly as the header sets it —
   only the dot's size is tied to the logotype's so it scales with it. */
.brand {
  font: 800 var(--brand) / 0.82 var(--display); letter-spacing: -0.02em;
  display: inline-block; color: var(--ink);
}
.brand > span { display: block; }
.brand-dot {
  color: var(--blue); font: calc(var(--brand) * 0.58) / 1 var(--body);
  margin-left: calc(var(--brand) * 0.17);
}

/* masthead: logotype over the headline, the dates below both */
.cover-masthead { --brand: 76px; }
.cover-masthead h1 { font-size: 124px; margin-top: 34px; }
.cover-masthead .dateline {
  font: 600 32px/1 var(--body); letter-spacing: 0.02em; color: var(--blue); margin-top: 18px;
}

/* lockup: logotype and dates share a line over a rule */
.cover-lockup { --brand: 52px; }
.cover-lockup .lockup-row {
  display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 2px solid var(--ink); padding-bottom: 22px;
}
.cover-lockup .lockup-date {
  font: 600 30px/1 var(--body); letter-spacing: 0.03em; color: var(--blue);
}
.cover-lockup h1 { font-size: 152px; margin-top: 30px; }

/* hero: the logotype is the headline and there is no second type block */
.cover-hero { --brand: 196px; }
.cover-hero .dateline {
  font: 600 38px/1 var(--body); letter-spacing: 0.01em; color: var(--blue); margin-top: 26px;
}

/* signoff: the headline as it was, the logotype signing off at the foot */
.cover-signoff { --brand: 44px; }
.cover-foot.signoff { align-items: center; }

/* ------------------------------------------------ covers led by the artwork */

.pic { padding: 0; --brand: 58px; }
.pic-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
  background: var(--paper); padding: 40px var(--pad) 34px; flex: none;
}
.pic-dates {
  text-align: right; font: 700 30px/1.15 var(--body); color: var(--ink);
}
.pic-dates span { display: block; font-weight: 500; color: var(--blue); }

/* The thumbnails sit edge to edge: a gutter would make them nine cards, and
   the point is one wall. Each caption is on its venue's colour, so the grid
   carries the same colour key as the calendar does. */
.cells { list-style: none; display: grid; flex: 1; min-height: 0; grid-auto-rows: 1fr; }
.pic-wall .cells { grid-template-columns: repeat(3, 1fr); }
.pic-six .cells { grid-template-columns: repeat(2, 1fr); }

/* However many the week has.
   One or two run as full-width bands: a two-column grid holding two listings
   is mostly hole. Three and five give their lead the whole top row and pair
   what is left, rather than stacking bands — three full-width rows squeeze
   each image into a 5:1 strip, which no production photograph survives.
   The captions grow as the cells do, so a quiet week reads as a design and
   not as a mistake. */
.cells-1, .cells-2 { grid-template-columns: 1fr !important; }
.cells-3 > .cell:first-child,
.cells-5 > .cell:first-child { grid-column: 1 / -1; }
.cells-1 .cell-cap h3, .cells-2 .cell-cap h3 { font-size: 74px; }
.cells-3 > .cell:first-child .cell-cap h3,
.cells-5 > .cell:first-child .cell-cap h3 { font-size: 62px; }
.cells-1 .cell-cap, .cells-2 .cell-cap { padding: 22px var(--pad) 26px; }
.cells-1 .cell-when, .cells-2 .cell-when { font-size: 24px; }
.cells-1 .cell-venue, .cells-2 .cell-venue { font-size: 23px; }

.cell { display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.cell-art { flex: 1; min-height: 0; background: var(--bar); }
.cell-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* Mounted on ink, the same as a show slide's artwork, so a poster looks the
   same object wherever it appears in the deck. */
.cell-art.whole { background: var(--ink); }
.cell-art.whole img { object-fit: contain; padding: 18px 22px; }
.cell-none {
  display: flex; height: 100%; align-items: center; justify-content: center;
  font: 800 44px/1 var(--display); color: var(--on-bar);
}
/* Captions on paper, with the venue's colour as a rule along the top. Six
   full bands of borrowed brand colour made the cover a colour chart with no
   entry point, and set the loudest venue rather than the best show at the top
   of the reader's eye. The colour still keys each cell; it no longer shouts. */
.cell-cap {
  background: var(--paper); color: var(--ink); padding: 13px 18px 16px; flex: none;
  border-top: 7px solid var(--bar);
}
.cell-when {
  font: 700 18px/1 var(--body); letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--blue); margin-bottom: 7px;
}
.cell-cap h3 {
  font: 800 34px/0.95 var(--display); letter-spacing: -0.005em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.cell-venue {
  font: 600 17px/1 var(--body); letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted); margin-top: 7px;
}
.pic-six .cell-cap { padding: 18px 24px 20px; }
.pic-six .cell-cap h3 { font-size: 46px; }
.pic-six .cell-when, .pic-six .cell-venue { font-size: 19px; }

.pic-tally {
  background: var(--ink); color: var(--paper); flex: none;
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 22px var(--pad) 24px;
  font: 500 26px/1 var(--body);
}
.pic-tally strong { font-weight: 700; }
.pic-url { font-weight: 700; color: var(--lilac); }

/* lead: one show at cover size, the rest along the foot */
.pic-lead .lead-art { position: relative; height: 860px; flex: none; background: var(--bar); }
.pic-lead .lead-art > img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pic-lead .lead-art.whole > img { object-fit: contain; }
.pic-lead .pic-head { position: absolute; top: 0; left: 0; right: 0; }
.lead-cap {
  position: absolute; left: 0; right: 0; bottom: 0;
  background: var(--bar); color: var(--on-bar); padding: 24px var(--pad) 28px;
}
.lead-flag {
  font: 700 24px/1 var(--body); letter-spacing: 0.12em; text-transform: uppercase;
  opacity: 0.85; margin-bottom: 12px;
}
.lead-cap h2 { font: 800 92px/0.9 var(--display); letter-spacing: -0.02em; }
.lead-venue { font: 600 26px/1 var(--body); letter-spacing: 0.04em; margin-top: 12px; text-transform: uppercase; }

.lead-more { flex: 1; display: flex; flex-direction: column; padding: 26px var(--pad) 0; min-height: 0; }
.more-label {
  font: 700 22px/1 var(--body); letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--blue); margin-bottom: 18px; flex: none;
}
.strip-cells { list-style: none; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; flex: 1; min-height: 0; }
.strip-cells .cell-cap { padding: 10px 12px 12px; }
.strip-cells .cell-cap h3 { font-size: 25px; -webkit-line-clamp: 2; }
.strip-cells .cell-when { font-size: 14px; margin-bottom: 5px; }
.strip-cells .cell-venue { display: none; }
.pic-foot { font: 500 24px/1 var(--body); color: var(--muted); padding: 20px 0 26px; flex: none; }
.pic-foot strong { color: var(--ink); font-weight: 700; }

.week-grid { position: relative; margin: 52px 0 0; }
.days {
  display: grid; grid-template-columns: repeat(7, 1fr); list-style: none;
  border-bottom: 2px solid var(--ink); padding-bottom: 10px; margin-bottom: 20px;
}
.days li { display: flex; align-items: baseline; gap: 8px; }
.days li + li { border-left: 1px solid var(--line); padding-left: 12px; }
.day-name { font: 700 24px/1 var(--body); letter-spacing: 0.1em; color: var(--ink); }
.day-num { font: 500 24px/1 var(--body); color: var(--muted); }

.tracks { list-style: none; display: flex; flex-direction: column; gap: 12px; }
.track { position: relative; height: 58px; display: block; }
.bar {
  position: absolute; top: 0; height: 58px; border-radius: 10px;
  left: calc(var(--from) * (100% / 7));
  width: calc(var(--span) * (100% / 7) - 6px);
  background: var(--bar); color: var(--on-bar);
  display: flex; align-items: center; padding: 0 18px;
}
.bar.open-left { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -6px; }
.bar.open-right { border-top-right-radius: 0; border-bottom-right-radius: 0; width: calc(var(--span) * (100% / 7)); }
.bar-title {
  font: 700 33px/1 var(--display); letter-spacing: 0.005em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Too narrow to hold its own name: the bar keeps its true width and the title
   steps outside it, in page ink rather than in the ink for the colour. Which
   side it goes depends on where the week still has room. */
.bar.side-right, .bar.side-left { padding: 0; }
.bar.side-right .bar-title,
.bar.side-left .bar-title {
  position: absolute; top: 50%; transform: translateY(-50%);
  color: var(--ink); max-width: 620px;
}
.bar.side-right .bar-title { left: calc(100% + 16px); }
.bar.side-left .bar-title { right: calc(100% + 16px); text-align: right; }

.cover-foot {
  display: flex; justify-content: space-between; align-items: flex-end;
  border-top: 2px solid var(--ink); padding-top: 22px;
}
.tally { font: 500 34px/1 var(--body); color: var(--muted); }
.tally strong { font-weight: 700; color: var(--ink); }
.wordmark { font: 700 34px/1 var(--body); color: var(--blue); }

/* ------------------------------------------------------- a show's slide */

/* The artwork takes whatever the words do not.
   It used to be pinned at 740px, so the slack landed in the paper below and
   fell in a different place on every slide — 170px of nothing under a short
   title, 5px under a long one. Now the panel is sized by its content and the
   image grows into the rest, which is the right way round: the artwork is the
   thing anyone actually wants to look at. */
.show .art { flex: 1; min-height: 540px; position: relative; background: var(--lilac); }
.show .art img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* A tour poster with the show's name set into it is mounted whole, on ink
   rather than on the venue's colour: a neutral mount recedes, where Pavilion
   green behind a navy poster is two mid-dark fields arguing. The padding is
   what makes it a mount and not a mistake — the poster was still being
   cropped top and bottom when it filled the frame edge to edge. */
.show .art.whole { background: var(--ink); }
.show .art.whole img { object-fit: contain; padding: 54px 76px; }
.art-fallback {
  height: 100%; display: flex; align-items: center; justify-content: center;
  background: var(--bar); color: var(--on-bar);
}
.art-fallback strong { font: 800 82px/1 var(--display); }

.panel { flex: none; padding: 40px var(--pad) 38px; }

.eyebrow-row {
  display: flex; align-items: center; gap: 14px; margin-bottom: 22px;
  font: 800 23px/1 var(--body); letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink);
}
.eyebrow-bar { width: 6px; height: 24px; background: var(--peach); flex: none; }

/* The venue's colour as a mark, not as type. Set as text it ranged from
   invisible — the Glad Café's yellow is 1.59:1 on paper — to indistinguishable
   from ink at the Citz's black, so how loud a venue looked was decided by that
   venue's brand guidelines rather than by us. As a square it identifies at any
   contrast and the name always reads. */
.venue-row {
  display: flex; align-items: center; gap: 14px; margin-bottom: 20px;
  font: 700 26px/1 var(--body); letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ink);
}
.venue-dot { width: 17px; height: 17px; background: var(--bar); flex: none; }

.lead-name {
  font: 700 42px/1 var(--display); letter-spacing: 0.02em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 8px;
}
/* Two sizes, not a sliding scale. Measuring the type to fit a fixed box meant
   the longer and less famous the show, the smaller its name got. */
.show h2 {
  font: 800 var(--title) / 0.88 var(--display); letter-spacing: -0.02em; color: var(--ink);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.blurb {
  font: 400 34px/1.4 var(--body); color: var(--ink); margin-top: 22px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

/* The house colour, full bleed. A hairline rule with right-aligned meta above
   it is the web card footer every product on earth ships; a band of the site's
   own lilac is Glasgow Theatre. It also stops the price being the loudest
   thing on a listing, which it was at 35px bold ink against a 31px grey blurb. */
.ticket {
  flex: none; background: var(--lilac); padding: 30px var(--pad) 34px;
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 8px 32px; flex-wrap: wrap;
}
.when { font: 600 32px/1.25 var(--body); color: var(--ink); }
.cost { font: 400 32px/1.25 var(--body); color: var(--muted); white-space: nowrap; }
.cost span + span::before { content: "\u00b7"; margin: 0 14px; }

</style>
</head>
<body class="preview">
<div class="deck">
${slides}
</div>
<script>
  if (new URLSearchParams(location.search).has("raw")) document.body.classList.remove("preview");
  // The title is the only thing on a slide whose height is not known in
  // advance, so it is the thing that gives. Counting characters guessed at
  // that and got "Justyna Jablonska - Unforeseen: Improvising Life and Music"
  // right by luck: the count says nothing about how wide the words set, and a
  // title one line longer pushed the date and the price out of the panel. The
  // panel is measured instead and the type steps down until they fit, which
  // is also why .strip and .facts do not shrink — the space they need is not
  // the title's to take.
  // Nothing is measured any more. Titles take one of two sizes chosen from
  // their length, the blurb is cut to a whole sentence before it is written,
  // and the artwork absorbs whatever is left — so the slide is correct when
  // the HTML is, with or without this script running.
</script>
</body>
</html>`;
}

/* ----------------------------------------------------------------- main */

/**
 * A WebP's dimensions, read from the file rather than the browser, so that a
 * crop decided without a model reading still has the shape to fall back on.
 */
function sizeOf(file) {
  try {
    const b = fs.readFileSync(file);
    const vp8 = b.indexOf("VP8", 12);
    if (b.slice(vp8, vp8 + 4).toString() === "VP8X")
      return {
        width: (b.readUIntLE(vp8 + 8, 3) & 0xffffff) + 1,
        height: (b.readUIntLE(vp8 + 11, 3) & 0xffffff) + 1,
      };
    if (b.slice(vp8, vp8 + 4).toString() === "VP8L") {
      const bits = b.readUInt32LE(vp8 + 9);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { width: b.readUInt16LE(vp8 + 14) & 0x3fff, height: b.readUInt16LE(vp8 + 16) & 0x3fff };
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--week");
  const today = new Date().toISOString().slice(0, 10);
  const monday = at >= 0 ? weekOf(args[at + 1]) : nextWeek(today);
  const sunday = iso(new Date(day(monday).getTime() + 6 * DAY));

  const events = read("events.json");
  const images = read("image-cache.json");
  const venueColour = (id, i) => VENUE_COLOURS[id] || RESERVE[i % RESERVE.length];

  const { chosen, all, tally } = selectShows(events, monday);
  const crops = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "crop-cache.json"), "utf8"));
    } catch {
      return {};
    }
  })();

  const shows = chosen.map((show, i) => {
    const image = show.image?.startsWith("/") ? show.image : images[show.image] || null;
    const name = image && path.basename(image);
    const size = name ? sizeOf(path.join(__dirname, "..", "src", "images", name)) : null;
    return {
      ...show,
      colour: venueColour(show.venueId, i),
      image,
      crop: cropFor(crops[name], size?.width || 1, size?.height || 1),
      blurb: blurb(show),
    };
  });


  // --covers renders the four ways the cover can carry the logotype, side by
  // side, so the choice is made by looking rather than by reading the code.
  if (args.includes("--covers")) {
    const plates = [...COVERS, ...PICTURE_COVERS].map(
      (variant, i) =>
        `<figure class="plate"><figcaption>${variant}</figcaption>${coverSlide(
          shows,
          monday,
          sunday,
          tally,
          variant,
          `cover-${i + 1}`,
        )}</figure>`,
    ).join("\n");
    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(path.join(DIST, "covers.html"), page(plates, monday, sunday));
    console.log(`  → dist/social/covers.html (${[...COVERS, ...PICTURE_COVERS].join(", ")})`);
    return;
  }

  // --grid proves the cover holds up in a week with almost nothing on, which
  // is the case that never turns up while you are looking at it.
  if (args.includes("--grid")) {
    const plates = [1, 2, 3, 4, 5, 6]
      .map((n) => {
        const few = shows.slice(0, n);
        const tally = {
          events: n,
          venues: new Set(few.map((s) => s.venueId)).size,
        };
        return `<figure class="plate"><figcaption>${n} event${n === 1 ? "" : "s"}</figcaption>${coverSlide(
          few,
          monday,
          sunday,
          tally,
          "six",
          `grid-${n}`,
        )}</figure>`;
      })
      .join("\n");
    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(path.join(DIST, "grid.html"), page(plates, monday, sunday));
    console.log("  → dist/social/grid.html (1 to 6 events)");
    return;
  }

  const cover = args.indexOf("--cover");
  const slides = [
    coverSlide(shows, monday, sunday, tally, cover >= 0 ? args[cover + 1] : "six"),
    ...shows.map((show, i) => showSlide(show, i + 1, monday, sunday)),
  ]
    .map(
      (slide, i) =>
        `<figure class="plate"><figcaption>Slide ${i + 1} of ${shows.length + 1}</figcaption>${slide}</figure>`,
    )
    .join("\n");

  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, "week.html"), page(slides, monday, sunday));
  fs.writeFileSync(
    path.join(DIST, "week.json"),
    JSON.stringify(
      {
        weekOf: monday,
        weekEnds: sunday,
        slides: shows.length + 1,
        shows: shows.map((s) => ({ id: s.id, title: s.title, venue: s.venue, opens: s.opens })),
        held: all.filter((a) => !shows.some((s) => s.id === a.id)).map((a) => a.id),
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Week of ${monday} – ${sunday}`);
  console.log(`  ${tally.events} events at ${tally.venues} venues, ${shows.length} on slides`);
  for (const show of shows) {
    console.log(`  ${show.opens ? "opens " : "on    "} ${show.venue} — ${show.title}`);
  }
  console.log(`  → dist/social/week.html`);
}

if (require.main === module) main();

module.exports = {
  weekOf,
  nextWeek,
  selectShows,
  runBar,
  runLabel,
  whenLabel,
  priceLabel,
  timeLabel,
  shortTitle,
  blurb,
};
