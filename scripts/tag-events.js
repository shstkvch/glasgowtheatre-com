#!/usr/bin/env node

/**
 * Glasgow Theatre Event Tagger
 *
 * Assigns an art form to scraped listings with a cheap LLM, replacing the
 * keyword matching that used to guess from substrings like "improv".
 *
 * Forms come from a fixed vocabulary (FORMS) so the homepage filter pills stay
 * a stable, meaningful set. The model never invents a tag.
 *
 * Results are cached in data/tag-cache.json, keyed by a hash of the text the
 * model actually sees. A listing is only sent once, so a daily refresh costs
 * nothing for shows that were already tagged, and re-running is free.
 *
 * Without OPENROUTER_API_KEY, or if the API fails, this falls back to the
 * keyword classifier and exits successfully. Tagging never breaks a build.
 *
 * Usage: node scripts/tag-events.js [--dry-run] [--retag]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { FORMS, STRUCTURAL, ALLOWED, fallbackForm, combine } = require("./art-forms");

const DATA_DIR = path.join(__dirname, "..", "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const CACHE_FILE = path.join(DATA_DIR, "tag-cache.json");
// What this run spent and what it dropped, so the daily report can say so.
// Written on every run, including the usual one that changes nothing.
const USAGE_FILE = path.join(DATA_DIR, "tag-usage.json");

const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const BATCH_SIZE = 12;
// Tries per group before it is halved, and per half before it is given up on.
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
// Groups abandoned before the run stops asking at all. See askAbout.
const GIVE_UP_AFTER = 2;
const readJSON = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/** The text the model sees, and the cache key derived from it. */
const promptText = (event) =>
  [
    // Part of the cache key as well as the prompt, so a listing that becomes
    // gated is re-judged rather than served a verdict-free cache entry.
    needsScopeCheck(event) ? "[SCOPE]" : null,
    event.title,
    event.venue,
    event.description,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

const cacheKey = (event) =>
  crypto
    .createHash("sha1")
    .update(`${MODEL}\n${promptText(event)}`)
    .digest("hex")
    .slice(0, 16);

/**
 * Venues that programme more than theatre. Their listings have to earn a place
 * on the site; a dedicated theatre's do not, because everything it stages is
 * in scope by definition.
 */
const VENUES_FILE = path.join(DATA_DIR, "venues.json");
const MIXED_PROGRAMME = new Set(
  (() => {
    try {
      return JSON.parse(fs.readFileSync(VENUES_FILE, "utf8"))
        .filter((venue) => venue.mixedProgramme)
        .map((venue) => venue.id);
    } catch {
      return [];
    }
  })(),
);

/**
 * Categories the source itself publishes that settle the question without
 * asking the model. Everything else at a mixed-programme venue is ambiguous:
 * a Concert at the King's might be a staged song cycle or might be a tribute
 * band, and only the description says which.
 */
const CLEAR_GENRES = new Set([
  "musicals", "plays", "play", "musical", "pantomime", "dance", "opera",
  "ballet", "comedy", "performance", "theatre",
]);

/** Whether this listing needs the model's opinion on belonging here at all. */
function needsScopeCheck(event) {
  if (!MIXED_PROGRAMME.has(event.venueId)) return false;
  const genre = (event.sourceGenre || "").toLowerCase().trim();
  return !CLEAR_GENRES.has(genre);
}

const SYSTEM_PROMPT = `You classify theatre and live performance listings for a Glasgow listings site.

Choose the ART FORM: what kind of thing the event is. Exactly one, from this
list and never anything else:

${Object.entries(FORMS)
  .map(([form, meaning]) => `- ${form}: ${meaning}`)
  .join("\n")}

Rules:
- Exactly one form. Pick the one a person would name if asked "what kind of
  thing is it?" - not the one the marketing copy shouts loudest.
- Classify what the event IS, not what it is about. A play about a musician is
  a play, not music. A musical about a boxer is a musical.
- A stand-up hour is "stand-up", even when the comedian is famous for
  television. A bill of several comedians is also "stand-up".
- A pantomime is "pantomime", not "musical" and not "stand-up", however funny
  or however many songs it has.
- "workshop" is for sessions the audience takes part in: classes, auditions,
  recruitment calls. A scratch night or work-in-progress that people sit and
  watch is a performance - use the form of the work being shown.
- A discussion, panel or Q&A about a play is "talk", even when extracts are
  performed during it. An event whose purpose is to look round the building is
  "tour".
- "community-event" is for a festival, fair or celebration made of many
  activities, not for a single performance that happens to involve a community
  cast.
- Where two forms could fit, prefer the more specific: "pantomime" over
  "musical", "opera" over "musical", "stand-up" over "cabaret".
- Judge from the whole listing. Ignore marketing hyperbole.

Some listings are marked [SCOPE]. Those come from venues that programme more
than theatre, and for those you must also decide whether the event belongs on a
theatre and live performance listings site at all.

In scope: plays, musicals, opera, dance, pantomime, comedy and stand-up,
cabaret, variety, drag, burlesque, spoken word, poetry and storytelling,
physical theatre, clown, circus and puppetry, and the talks, tours and
workshops a venue runs alongside that work.

Out of scope: gigs, concerts and club nights where the music itself is the
event, including tribute acts and covers bands; karaoke, quizzes, bingo and
open-decks nights; film screenings; visual art exhibitions; markets, fairs and
conventions; sport; and classes with no performing-arts content, such as
knitting, crafts, fitness or wellbeing groups.

The distinction is what the audience is there to do. A show built around music
but staged as theatre is in scope. A band playing its own songs is not, however
theatrical the staging. When a listing is genuinely too thin to judge, treat it
as in scope and say so in the reason.

For a listing not marked [SCOPE], return inScope true and an empty reason.
Keep every reason under eight words.`;

const SCHEMA = {
  name: "listing_form",
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
            form: { type: "string", enum: Object.keys(FORMS) },
            inScope: { type: "boolean" },
            scopeReason: { type: "string" },
          },
          required: ["index", "form", "inScope", "scopeReason"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
};

async function tagBatch(batch, apiKey) {
  const listings = batch
    .map((event, i) => `[${i}] ${promptText(event)}`)
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
          content: `Tag these ${batch.length} listings. Return one result per listing, using the given index.\n\n${listings}`,
        },
      ],
      // This model reasons by default; tagging does not need it and it costs tokens.
      reasoning: { enabled: false },
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_schema", json_schema: SCHEMA },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || "API error");

  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");

  if (body.choices[0].finish_reason === "length") {
    throw new Error("Response truncated before the model finished");
  }

  const parsed = JSON.parse(content);
  const results = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(results)) throw new Error("Response had no results array");

  const byIndex = new Map(results.map((r) => [r.index, r]));
  const verdicts = batch.map((_, i) => byIndex.get(i));

  // A response missing an index is a failure, not a success with a hole in it.
  // It used to pass silently: the run logged a tick and billed for the batch
  // while the unanswered listings took a keyword guess, which is how three
  // gigs came to be published as plays.
  const missing = verdicts.filter((verdict) => !verdict).length;
  if (missing) {
    throw new Error(
      `Model answered ${batch.length - missing} of ${batch.length} listings`,
    );
  }

  return {
    verdicts,
    cost: body.usage?.cost || 0,
    promptTokens: body.usage?.prompt_tokens || 0,
    completionTokens: body.usage?.completion_tokens || 0,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask about a group of listings, and keep asking before giving up on them.
 *
 * One request that does not come back used to cost every listing in its batch
 * a classification, and the keyword fallback's last resort is a guess: twelve
 * listings fell back because one call failed, and the three at music venues
 * were published as plays.
 *
 * So a failed group is retried, and then halved. A retry clears the transient
 * case - a timeout, a 429, a bad gateway. Halving separates the other one, a
 * single listing the model chokes on, so eleven are not punished for the
 * twelfth. Halves are not halved again: past that the cause is not the batch.
 *
 * Verdicts are written straight into the cache. Listings nothing could be got
 * for are left out of it, and picked up as fallbacks by the caller.
 */
async function askAbout(group, apiKey, label, ctx, canSplit = true) {
  // During an outage every group fails the same way, and waiting out the
  // retries on each of fourteen batches would keep the build going for an
  // hour to learn what the first two already said.
  if (ctx.abandoned >= GIVE_UP_AFTER) return;

  let error;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const result = await tagBatch(group, apiKey);
      ctx.cost += result.cost;
      ctx.promptTokens += result.promptTokens;
      ctx.completionTokens += result.completionTokens;
      group.forEach((event, i) => {
        const verdict = result.verdicts[i];
        if (!ALLOWED.has(verdict.form)) return;
        ctx.cache[cacheKey(event)] = {
          form: verdict.form,
          inScope: verdict.inScope !== false,
          scopeReason: (verdict.scopeReason || "").trim(),
          model: MODEL,
          taggedAt: TODAY_ISO,
        };
      });
      const again = attempt > 1 ? ` (attempt ${attempt})` : "";
      const plural = group.length === 1 ? "" : "s";
      console.log(`${label} ✓ ${group.length} listing${plural}${again}`);
      return;
    } catch (err) {
      error = err;
      console.log(`${label} ✗ attempt ${attempt}/${ATTEMPTS}: ${err.message}`);
      const delay = ctx.retryDelayMs ?? RETRY_DELAY_MS;
      if (attempt < ATTEMPTS) await sleep(delay * attempt);
    }
  }

  if (canSplit && group.length > 1) {
    const half = Math.ceil(group.length / 2);
    console.log(`${label} splitting ${group.length} listings and asking again`);
    await askAbout(group.slice(0, half), apiKey, `${label}a`, ctx, false);
    await askAbout(group.slice(half), apiKey, `${label}b`, ctx, false);
    return;
  }

  ctx.abandoned += 1;
  console.log(`${label} ✗ gave up: ${error.message}`);
  if (ctx.abandoned === GIVE_UP_AFTER) {
    console.log(
      `  ! ${GIVE_UP_AFTER} groups abandoned — not asking about the rest of this run`,
    );
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const retag = process.argv.includes("--retag");

  const events = readJSON(EVENTS_FILE, null);
  if (!Array.isArray(events)) {
    console.error(`✗ Could not read ${EVENTS_FILE}`);
    process.exit(1);
  }

  const cache = retag ? {} : readJSON(CACHE_FILE, {});
  const apiKey = process.env.OPENROUTER_API_KEY;

  console.log(`\n🏷  Tagging ${events.length} listings with ${MODEL}`);

  // A cached entry from before the scope check existed carries tags but no
  // verdict, so a gated listing with one still has to be asked about.
  const pending = events.filter((event) => {
    const hit = cache[cacheKey(event)];
    if (!hit || !ALLOWED.has(hit.form)) return true;
    return needsScopeCheck(event) && typeof hit.inScope !== "boolean";
  });
  console.log(
    `  ${events.length - pending.length} already tagged, ${pending.length} to tag`,
  );

  const ctx = {
    cache,
    cost: 0,
    promptTokens: 0,
    completionTokens: 0,
    abandoned: 0,
  };

  if (pending.length && !apiKey) {
    console.log("  ! OPENROUTER_API_KEY is not set — using keyword fallback");
  }

  if (pending.length && apiKey) {
    const batches = Math.ceil(pending.length / BATCH_SIZE);
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const label = `  batch ${Math.floor(i / BATCH_SIZE) + 1}/${batches}`;
      await askAbout(batch, apiKey, label, ctx);
    }
  }

  // What the run actually managed, read back off the cache rather than
  // counted along the way, so it is the same condition the forms are chosen
  // by below and cannot drift from it.
  const fellBack = pending.filter((event) => {
    const hit = cache[cacheKey(event)];
    return !hit || !ALLOWED.has(hit.form);
  });
  if (fellBack.length) {
    console.log(
      `\n  ! ${fellBack.length} of ${pending.length} listings were never classified — keyword fallback:`,
    );
    for (const event of fellBack) {
      console.log(`    - ${event.title.slice(0, 44).padEnd(44)} ${event.venue}`);
    }
  }

  let fromModel = 0;
  let fromKeywords = 0;
  const tagged = events.map((event) => {
    const hit = cache[cacheKey(event)];
    if (hit && ALLOWED.has(hit.form)) fromModel++;
    else fromKeywords++;
    // The venue decides what an unclassified listing is guessed to be, so a
    // gig at a music venue is not filed as a play.
    const options = { mixedProgramme: MIXED_PROGRAMME.has(event.venueId) };
    const form =
      hit && ALLOWED.has(hit.form) ? hit.form : fallbackForm(event, options);
    return { ...event, form, tags: combine(event, form, options) };
  });

  // Fail open. A listing with no verdict — the API was down, the response was
  // malformed, the venue is not gated — stays on the site. An outage must never
  // quietly empty the listings.
  const excluded = [];
  const listed = tagged.filter((event) => {
    if (!needsScopeCheck(event)) return true;
    const hit = cache[cacheKey(event)];
    if (!hit || typeof hit.inScope !== "boolean" || hit.inScope) return true;
    excluded.push({
      title: event.title,
      venue: event.season || event.venue,
      reason: hit.scopeReason || "not theatre",
    });
    return false;
  });

  if (excluded.length) {
    console.log(`\n  ${excluded.length} listings out of scope:`);
    for (const item of excluded) {
      console.log(`    - ${item.title.slice(0, 44).padEnd(44)} ${item.venue} — ${item.reason}`);
    }
  }

  const changed = tagged.filter((event, i) => events[i].form !== event.form);

  console.log(
    `\n  ${fromModel} classified by model, ${fromKeywords} by keyword fallback`,
  );
  console.log(`  ${changed.length} listings changed form`);
  for (const event of changed.slice(0, 15)) {
    const before = events.find((e) => e.id === event.id);
    console.log(
      `    ${event.title.slice(0, 42).padEnd(42)} ${before.form || "—"} → ${event.form}`,
    );
  }
  if (changed.length > 15) console.log(`    …and ${changed.length - 15} more`);
  // listingsTagged is what the model actually answered about, not what was
  // put to it. It counted the pending listings before, so a run that asked
  // about seventeen and heard back about five still reported seventeen, and
  // the twelve keyword guesses went unmentioned in the morning email.
  const usage = {
    at: new Date().toISOString(),
    model: MODEL,
    listingsPending: apiKey ? pending.length : 0,
    listingsTagged: apiKey ? pending.length - fellBack.length : 0,
    promptTokens: ctx.promptTokens,
    completionTokens: ctx.completionTokens,
    totalTokens: ctx.promptTokens + ctx.completionTokens,
    costUsd: ctx.cost,
    excluded,
    fellBack: fellBack.map((event) => ({
      title: event.title,
      venue: event.season || event.venue,
    })),
  };
  console.log(`  ${usage.totalTokens} tokens, cost: $${ctx.cost.toFixed(5)}`);

  if (dryRun) {
    console.log("\n  (dry run — nothing written)");
    return;
  }

  fs.writeFileSync(EVENTS_FILE, JSON.stringify(listed, null, 2) + "\n");
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2) + "\n");
  console.log(
    `\n  ✓ Wrote ${listed.length} listings to ${path.basename(EVENTS_FILE)}`,
  );
  if (fellBack.length) {
    console.log(
      "  ! Some listings used the keyword fallback. They will be retried on the next run.",
    );
  }
}

const TODAY_ISO = new Date().toISOString().slice(0, 10);

if (require.main === module) {
  main().catch((err) => {
    // Tagging must never break a refresh; the previous tags stay in place.
    console.error(`✗ Tagging failed: ${err.message}`);
    process.exit(0);
  });
}

module.exports = {
  FORMS,
  STRUCTURAL,
  combine,
  fallbackForm,
  cacheKey,
  needsScopeCheck,
  tagBatch,
  askAbout,
  ATTEMPTS,
};
