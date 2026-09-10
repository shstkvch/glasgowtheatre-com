#!/usr/bin/env node

/**
 * Glasgow Theatre Ticket Reader
 *
 * Turns the sentence a venue publishes about its prices and its show times
 * into numbers a listing can carry.
 *
 * There is no shared format to parse. Eleven venues write eleven ways:
 *
 *   £14 - £43.50
 *   £20/£12
 *   Previews: £16 | Main Run: £19, £23 or £26
 *   £10.50 (standard) | £7 (concession) | £6
 *   Monday: £17 / Tuesday-Friday: £19 / Saturday: £22.50
 *   Tickets £5-£20 (sliding scale)
 *   Pay-What-You-Like
 *
 * A regular expression can be made to fit all seven, and then a venue rewrites
 * one line and it quietly returns the wrong number — which is worse than none,
 * because a wrong price is a promise the site cannot keep. So the reading is
 * done by the same cheap model that assigns art forms, against a strict JSON
 * schema, and cached the same way: keyed by a hash of the exact text the model
 * saw, so a listing costs one call the first time and nothing afterwards.
 *
 * Structured sources are never sent. Where a venue publishes machine-readable
 * prices and times — the Citz's schedule, ATG's and Trafalgar's per-performance
 * offers, the Tron's box office API — the scraper already has the numbers and
 * this pass leaves them alone.
 *
 * It fails open, like the tagger. Without OPENROUTER_API_KEY, or if the API is
 * down, the deterministic reader in tickets.js stands and every listing keeps
 * whatever price it had. A ticket price is never a reason to break a build.
 *
 * Usage: node scripts/read-tickets.js [--dry-run] [--reread]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readPricing, headlineTime } = require("./tickets");

const DATA_DIR = path.join(__dirname, "..", "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const CACHE_FILE = path.join(DATA_DIR, "ticket-cache.json");
const USAGE_FILE = path.join(DATA_DIR, "ticket-usage.json");

const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const BATCH_SIZE = 10;
const TODAY_ISO = new Date().toISOString().slice(0, 10);

const readJSON = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The wording this listing has that a person, but not a parser, can read. */
const published = (event) => ({
  prices: (event.pricing && event.pricing.text) || null,
  times: event.scheduleText || null,
});

/**
 * A schedule this pass worked out, rather than one the venue published in a
 * form the scraper could read. It is marked so a later run can replace it:
 * without that the pass would read its own previous output as untouchable
 * structured data and could never correct itself.
 */
const ownSchedule = (event) => event.scheduleRead === "model";

/** Whether there is anything here worth a model's opinion. */
function needsReading(event) {
  const { prices, times } = published(event);
  if (!prices && !times) return false;
  // A run whose performances came from the venue in machine-readable form
  // needs no schedule read, and a price that came from an offers feed needs no
  // price read. Both at once means there is nothing left to ask about.
  const schedule = !!times && (ownSchedule(event) || !(event.performances || []).length);
  const price = !!prices;
  return schedule || price;
}

/** Exactly what the model sees, and therefore what the cache is keyed on. */
function promptText(event) {
  const { prices, times } = published(event);
  return [
    `VENUE: ${event.venue}`,
    `SHOW: ${event.title}`,
    `RUNS: ${event.date}${event.endDate && event.endDate !== event.date ? ` to ${event.endDate}` : ""}`,
    prices ? `PRICES AS PUBLISHED:\n${prices}` : "PRICES AS PUBLISHED: (none)",
    times ? `TIMES AS PUBLISHED:\n${times}` : "TIMES AS PUBLISHED: (none)",
  ].join("\n");
}



const SYSTEM_PROMPT = `You read what a theatre publishes about its ticket prices and performance times, and return it as data. You are reading British theatre listings from Glasgow. All prices are pounds sterling.

For each listing return:

- from: the cheapest STANDARD ticket price, as a number. A standard ticket is
  one anyone can buy. Previews, midweek nights, restricted views and different
  seating bands are all standard prices at different levels, so the cheapest of
  those is "from". Null if no price is published.
- to: the dearest standard price, as a number, or null if only one is published.
- concession: the cheapest price that requires the buyer to QUALIFY for it -
  concessions, students, under-26s, over-60s, children, unwaged, low income,
  local residents, access. Null if none is published. Never put a standard
  price here, and never repeat "from" here.
- concessionTo: the dearest qualifying price, when more than one is published,
  or null when there is only one. "£7 (concession) | £6" has concession 6 and
  concessionTo 7, because 6 is a floor rather than the price everyone who
  qualifies will pay.
- free: true only if the event has no ticket price at all. "Free but ticketed"
  and "Free (booking required)" are still free.
- payWhatYouLike: true if the buyer chooses what to pay. A suggested or
  recommended amount alongside it goes in "from".
- performances: the individual performances, when the text NAMES particular
  dates - "Fri 2 Oct @ 7pm & Sat 3 Oct @ 2pm & 7pm" is three performances.
  Each is {"date":"YYYY-MM-DD","time":"HH:MM"}. Take the year from the run
  dates given above. Return an empty list when the text describes a pattern
  rather than naming dates, and never list a date the text does not name.
- days: which days of the week the run plays, as a list from
  ["mon","tue","wed","thu","fri","sat","sun"]. Only fill this in when the
  published times SAY which days - "Monday - Saturday 1pm" is mon..sat, and
  "Thursday evenings" is thu. Return an empty list when it is not stated or
  when the wording is vague ("Day & evening shows", "Various dates"). Never
  guess from the run's date range.
- time: the usual curtain time as 24-hour "HH:MM", or null. Use the time the
  performance starts. If several times are published, give the one that occurs
  most. If a door time and a start time are both given, give the start.
- byDay: an object mapping day names to the standard price on that day, when
  and only when the venue prices by the day of the week ("Monday: £17,
  Tuesday-Friday: £19, Saturday: £22.50" is {"mon":17,"tue":19,"wed":19,
  "thu":19,"fri":19,"sat":22.5}). Null otherwise.

Rules:
- Report only what the text says. Never estimate, average, round or infer a
  price from what a show like this usually costs. Null is always better than
  a plausible number.
- Two prices divided by a slash and nothing else - "£18/£12", "£20/£12" - is
  the long-standing British convention for full price then concession. The
  dearer is "from" and the cheaper is "concession". A slash between prices
  that already carry their own labels means only what those labels say.
- Booking fees are not a price. If the text says a fee is included, the price
  is still the price as published.
- Ignore prices that are not for a ticket to this event: memberships, gift
  vouchers, food and drink sold separately, workshops attached to a run.
- A price for a whole block or term of classes is still "from".

Worked examples:

  "£14 - £43.50"
    from 14, to 43.50, concession null.
  "£20/£12"
    from 20, concession 12. The slash convention.
  "Previews: £16 | Main Run: £19, £23 or £26"
    from 16, to 26, concession null. Previews and price points are all
    standard prices.
  "£10.50 (standard) | £7 (concession) | £6"
    from 10.50, concession 6, concessionTo 7. The bare £6 is a third rate you
    have to qualify for, so the cheapest qualifying price is 6, not 7.
  "Adult £12.50 - £43.50, Child £9.25 - £22"
    from 12.50, to 43.50, concession 9.25. A child price is a qualifying price.
  "Tickets £5-£20 (sliding scale)"
    from 5, to 20, payWhatYouLike true.
  "Monday: £17 / Tuesday-Friday: £19 / Saturday: £22.50", run Mon to Sat
    from 17, to 22.50, days mon..sat, byDay {"mon":17,"tue":19,"wed":19,
    "thu":19,"fri":19,"sat":22.5}.
  "Free but Ticketed"
    free true, everything else null.`;

const SCHEMA = {
  name: "tickets",
  strict: true,
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            from: { type: ["number", "null"] },
            to: { type: ["number", "null"] },
            concession: { type: ["number", "null"] },
            concessionTo: { type: ["number", "null"] },
            free: { type: "boolean" },
            payWhatYouLike: { type: "boolean" },
            performances: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string" },
                  time: { type: "string" },
                },
                required: ["date", "time"],
                additionalProperties: false,
              },
            },
            days: {
              type: "array",
              items: { type: "string", enum: DAYS.slice(1).concat("sun") },
            },
            time: { type: ["string", "null"] },
            byDay: { type: ["object", "null"], additionalProperties: { type: "number" } },
          },
          required: [
            "index", "from", "to", "concession", "concessionTo", "free",
            "payWhatYouLike", "performances", "days", "time", "byDay",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
};

/**
 * The instructions themselves are part of the key.
 *
 * A cache keyed only on the listing would serve yesterday's answer after the
 * prompt has been sharpened or a field added to the schema, so the improvement
 * would never reach anything already read. Re-reading the whole programme
 * costs about a fifth of a penny, which is not worth being clever about.
 */
const INSTRUCTIONS = crypto
  .createHash("sha1")
  .update(SYSTEM_PROMPT + JSON.stringify(SCHEMA))
  .digest("hex")
  .slice(0, 8);

const cacheKey = (event) =>
  crypto
    .createHash("sha1")
    .update(`${MODEL}\n${INSTRUCTIONS}\n${promptText(event)}`)
    .digest("hex")
    .slice(0, 16);

async function readBatch(batch, apiKey) {
  const listings = batch
    .map((event, i) => `[${i}]\n${promptText(event)}`)
    .join("\n\n---\n\n");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://glasgowtheatre.com",
      "X-Title": "Glasgow Theatre",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Read these ${batch.length} listings. Return one result per listing, using the given index.\n\n${listings}`,
        },
      ],
      reasoning: { enabled: false },
      temperature: 0,
      max_tokens: 3000,
      response_format: { type: "json_schema", json_schema: SCHEMA },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || "API error");
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");
  if (body.choices[0].finish_reason === "length")
    throw new Error("Response truncated before the model finished");

  const parsed = JSON.parse(content);
  const results = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(results)) throw new Error("Response had no results array");
  const byIndex = new Map(results.map((r) => [r.index, r]));
  return {
    readings: batch.map((_, i) => byIndex.get(i) || null),
    cost: body.usage?.cost || 0,
    promptTokens: body.usage?.prompt_tokens || 0,
    completionTokens: body.usage?.completion_tokens || 0,
  };
}

const money = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1000
    ? Math.round(value * 100) / 100
    : null;

/**
 * A reading is only kept if it is internally coherent.
 *
 * The model is cheap and occasionally confident about nonsense, so the answers
 * that would put a wrong number on a card are dropped rather than corrected: a
 * concession dearer than the full price, a range that runs backwards, a curtain
 * time that is not a time. What survives is what the deterministic reader would
 * have had to agree with anyway.
 */
function sane(reading) {
  if (!reading) return null;
  const from = money(reading.from);
  const to = money(reading.to);
  const concession = money(reading.concession);
  const concessionTo = money(reading.concessionTo);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(reading.time)) ? reading.time : null;
  const days = [...new Set((reading.days || []).map((d) => DAYS.indexOf(String(d).slice(0, 3))))]
    .filter((day) => day >= 0)
    .sort();
  const byDay = Object.fromEntries(
    Object.entries(reading.byDay || {})
      .map(([day, amount]) => [DAYS.indexOf(String(day).slice(0, 3)), money(amount)])
      .filter(([day, amount]) => day >= 0 && amount != null),
  );
  const performances = (reading.performances || [])
    .filter(
      (p) =>
        p &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(p.date)) &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.time)),
    )
    .map((p) => ({ date: p.date, time: p.time }));
  return {
    from,
    to: to != null && from != null && to > from ? to : null,
    concession: concession != null && from != null && concession < from ? concession : null,
    concessionTo:
      concessionTo != null && concession != null && concessionTo > concession
        ? concessionTo
        : null,
    free: reading.free === true && from == null,
    payWhatYouLike: reading.payWhatYouLike === true,
    performances,
    days,
    time,
    byDay: Object.keys(byDay).length ? byDay : null,
  };
}

/** Every date in a run, both ends included. */
function datesBetween(from, to) {
  const days = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86400000)
    days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

/**
 * The dates a run actually plays.
 *
 * Two shapes of wording, and they need different handling. Platform names its
 * dates outright — "Fri 2 Oct @ 7pm & Sat 3 Oct @ 2pm & 7pm" is three
 * performances, two of them on one day — so those are taken as given, bounded
 * to a season either side of the run's own start so a misread year cannot put
 * a show in 2027.
 *
 * A Play, A Pie and A Pint instead names a pattern: "Monday – Saturday 1pm"
 * against a Monday to Saturday run describes every performance in it without
 * listing one, and a reader wants to know it is on the Thursday. That is only
 * expanded where the run has an end date to expand between, because a weekly
 * class with no published finish would otherwise become a single lonely date
 * that reads as the whole term.
 */
const A_SEASON = 92 * 86400000;

function schedule(event, reading) {
  const opens = Date.parse(`${event.date}T00:00:00Z`);
  const named = (reading.performances || []).filter((p) => {
    const at = Date.parse(`${p.date}T00:00:00Z`);
    return at >= opens && at <= opens + A_SEASON;
  });
  if (named.length) return named;

  const closes = event.endDate && event.endDate > event.date ? event.endDate : null;
  if (!reading.days.length || !reading.time || !closes) return null;
  const dates = datesBetween(event.date, closes).filter((date) =>
    reading.days.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
  );
  if (dates.length < 2) return null;
  return dates.map((date) => {
    const price = reading.byDay
      ? reading.byDay[new Date(`${date}T00:00:00Z`).getUTCDay()]
      : null;
    return { date, time: reading.time, ...(price != null ? { price } : {}) };
  });
}

/** What the listing carries after a reading, leaving the venue's wording alone. */
function apply(event, reading) {
  const next = { ...event };
  const had = event.pricing || {};
  if (had.text) {
    next.pricing = {
      ...had,
      from: reading.free ? 0 : reading.from,
      to: reading.to,
      concession: reading.concession,
      concessionTo: reading.concessionTo ?? null,
      free: reading.free,
      payWhatYouLike: reading.payWhatYouLike,
      // Which reader produced the numbers, so a bad batch can be found later.
      read: "model",
    };
  }
  const settled = (event.performances || []).length && !ownSchedule(event);
  const dates = settled ? null : schedule(event, reading);
  if (dates) {
    next.performances = dates;
    next.scheduleRead = "model";
    next.time = headlineTime(dates) || next.time;
    // A venue that names dates past the run it advertised has told us the run
    // is longer than the listing said. Platform's "Fri 2 Oct & Sat 3 Oct" is
    // a two-day run whose listing carried only the Friday.
    const last = dates[dates.length - 1].date;
    if (last > (next.endDate || next.date)) next.endDate = last;
  } else if (reading.time && !next.time) {
    next.time = reading.time;
  }
  return next;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const reread = process.argv.includes("--reread");

  const events = readJSON(EVENTS_FILE, null);
  if (!Array.isArray(events)) {
    console.error(`✗ Could not read ${EVENTS_FILE}`);
    process.exit(1);
  }

  const cache = reread ? {} : readJSON(CACHE_FILE, {});
  const apiKey = process.env.OPENROUTER_API_KEY;
  const candidates = events.filter(needsReading);

  console.log(`\n🎟  Reading ticket wording on ${candidates.length} listings with ${MODEL}`);

  const pending = candidates.filter((event) => !cache[cacheKey(event)]);
  console.log(`  ${candidates.length - pending.length} already read, ${pending.length} to read`);

  let cost = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let failed = false;

  if (pending.length && !apiKey) {
    console.log("  ! OPENROUTER_API_KEY is not set — keeping the fallback reading");
    failed = true;
  }

  if (pending.length && apiKey) {
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const label = `  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pending.length / BATCH_SIZE)}`;
      try {
        const result = await readBatch(batch, apiKey);
        batch.forEach((event, j) => {
          const reading = sane(result.readings[j]);
          if (reading) cache[cacheKey(event)] = { ...reading, model: MODEL, readAt: TODAY_ISO };
        });
        cost += result.cost;
        promptTokens += result.promptTokens;
        completionTokens += result.completionTokens;
        console.log(`${label} ✓ ${batch.length} listings`);
      } catch (err) {
        failed = true;
        console.log(`${label} ✗ ${err.message} — keeping the fallback reading for these`);
      }
    }
  }

  let fromModel = 0;
  const changes = [];
  const updated = events.map((event) => {
    if (!needsReading(event)) return event;
    const hit = cache[cacheKey(event)];
    if (!hit) return event;
    fromModel++;
    const next = apply(event, hit);
    const before = readPricing(event.pricing && event.pricing.text);
    if (before && (before.from !== next.pricing?.from || before.concession !== next.pricing?.concession))
      changes.push(
        `${event.title.slice(0, 34).padEnd(34)} ${JSON.stringify(event.pricing.text).slice(0, 46)} → from ${next.pricing?.from} conc ${next.pricing?.concession}`,
      );
    return next;
  });

  console.log(`\n  ${fromModel} listings read by the model, ${candidates.length - fromModel} left to the fallback`);
  if (changes.length) {
    console.log(`  ${changes.length} differ from the fallback reading:`);
    for (const line of changes.slice(0, 12)) console.log(`    ${line}`);
    if (changes.length > 12) console.log(`    …and ${changes.length - 12} more`);
  }
  const scheduled = updated.filter(
    (e, i) => (e.performances || []).length && !(events[i].performances || []).length,
  ).length;
  if (scheduled) console.log(`  ${scheduled} runs gained a list of performance dates`);
  console.log(
    `  ${promptTokens + completionTokens} tokens, cost: $${cost.toFixed(5)}`,
  );

  if (dryRun) {
    console.log("\n  (dry run — nothing written)");
    return;
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(updated, null, 2) + "\n");
  fs.writeFileSync(
    USAGE_FILE,
    JSON.stringify(
      // The same shape the tagger writes, so the daily report can say what
      // both model passes spent without special-casing either.
      {
        at: new Date().toISOString(),
        model: MODEL,
        listingsRead: pending.length,
        listingsWithWording: candidates.length,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd: cost,
        failed,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\n  ✓ Wrote ${updated.length} listings to ${EVENTS_FILE}`);
}

module.exports = { sane, schedule, needsReading, promptText, apply, ownSchedule };

if (require.main === module)
  main().catch((err) => {
    // Never a reason to break a build: the fallback reading already stands.
    console.error(`\n✗ Ticket reading failed: ${err.message}`);
    process.exit(0);
  });
