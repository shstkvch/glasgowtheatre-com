#!/usr/bin/env node

/**
 * Glasgow Theatre Event Tagger
 *
 * Assigns genre tags to scraped listings with a cheap LLM, replacing the
 * keyword matching that used to guess from substrings like "improv".
 *
 * Tags come from a fixed vocabulary (TAGS) so the homepage filter pills stay
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
const { classifyTags } = require("./scrape-events");

const DATA_DIR = path.join(__dirname, "..", "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const CACHE_FILE = path.join(DATA_DIR, "tag-cache.json");

const MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const BATCH_SIZE = 12;
const MAX_TAGS = 3;

/**
 * The complete tag vocabulary. Anything the model returns that is not in this
 * list is discarded. Keep this list short: every tag becomes a filter pill.
 */
const TAGS = {
  drama: "A play, serious or dramatic in tone.",
  comedy: "Comedy, stand-up, or a play whose main purpose is to be funny.",
  musical: "Musical theatre, where songs carry the story.",
  opera: "Opera or operetta.",
  dance: "Dance or choreographed movement as the main form.",
  "physical-theatre": "Physical, visual, circus, puppetry or mime-led work.",
  "new-writing": "A new play or premiere of a recently written work.",
  classic: "An established repertoire text: Shakespeare, Greek tragedy, Ibsen, Beckett and the like.",
  experimental: "Experimental, avant-garde, live art or performance art.",
  family: "Explicitly aimed at children or family audiences.",
  music: "A concert or gig, where live music is the event itself.",
  "spoken-word": "Poetry, storytelling or spoken word performed to an audience.",
  talk: "A discussion, panel, Q&A, lecture or post-show conversation about a subject.",
  cabaret: "Cabaret, variety, drag or burlesque.",
  workshop: "A class, workshop, audition or participatory session rather than a performance to watch.",
  tour: "A guided tour of the building or a behind-the-scenes visit.",
};

/**
 * Tags the scrapers assign from the source itself, not from the text. These
 * describe how or where a show runs, so the model never sets or removes them.
 */
const STRUCTURAL = new Set(["a-play-a-pie-a-pint", "lunchtime", "scratch"]);

/**
 * These describe events that are not performances to watch. They are exclusive:
 * a discussion about a play is a talk, not a talk AND a drama. Enforced in
 * combine() rather than left to the prompt, because the model kept pairing
 * them with a genre.
 */
const NON_PERFORMANCE = ["talk", "workshop", "tour"];

const ALLOWED = new Set(Object.keys(TAGS));

const readJSON = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/** The text the model sees, and the cache key derived from it. */
const promptText = (event) =>
  [event.title, event.venue, event.description].filter(Boolean).join("\n").trim();

const cacheKey = (event) =>
  crypto
    .createHash("sha1")
    .update(`${MODEL}\n${promptText(event)}`)
    .digest("hex")
    .slice(0, 16);

/** Keyword tags, narrowed to the current vocabulary, used when the API is unavailable. */
function fallbackTags(event) {
  const guessed = classifyTags(
    event.title,
    event.description || "",
    event.type || "professional",
  );
  const kept = guessed.filter((tag) => ALLOWED.has(tag));
  return kept.length ? kept.slice(0, MAX_TAGS) : ["drama"];
}

/** Merge model tags with the structural tags the scraper already set. */
function combine(event, tags) {
  const structural = (event.tags || []).filter((tag) => STRUCTURAL.has(tag));
  const valid = tags.filter((tag) => ALLOWED.has(tag));
  const exclusive = valid.filter((tag) => NON_PERFORMANCE.includes(tag));
  const genre = (exclusive.length ? exclusive : valid).slice(0, MAX_TAGS);
  return [...new Set([...genre, ...structural])];
}

const SYSTEM_PROMPT = `You tag theatre and live performance listings for a Glasgow listings site.

For each listing, choose between 1 and ${MAX_TAGS} tags from this list, most important first:

${Object.entries(TAGS)
  .map(([tag, meaning]) => `- ${tag}: ${meaning}`)
  .join("\n")}

Rules:
- Only use tags from the list. Never invent one.
- Tag what the event IS, not what it mentions. A play about a musician is not "music". A drama where a family falls apart is not "family".
- "family" means the show is for children or families to attend together.
- "talk", "workshop" and "tour" describe events that are not performances to watch. When one of them fits, it is the ONLY tag you return.
- "workshop" is for sessions the audience takes part in: classes, auditions, recruitment calls. A scratch night, showcase or work-in-progress that people sit and watch is a performance, not a workshop.
- Only use "drama" for a play performed by actors. A discussion, panel or Q&A about a play is "talk" alone, even when extracts are performed during it.
- An event whose purpose is to look round the building is "tour" alone.
- Prefer the specific tag over the general one. Use "drama" when nothing more specific fits a performed play.
- Judge from the whole listing. Ignore marketing hyperbole.`;

const SCHEMA = {
  name: "listing_tags",
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
            // The bounds matter: without maxItems the model will happily
            // repeat tags until it runs out of tokens.
            tags: {
              type: "array",
              minItems: 1,
              maxItems: MAX_TAGS,
              items: { type: "string", enum: Object.keys(TAGS) },
            },
          },
          required: ["index", "tags"],
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

  const byIndex = new Map(results.map((r) => [r.index, r.tags || []]));
  return {
    tags: batch.map((_, i) => byIndex.get(i) || []),
    cost: body.usage?.cost || 0,
  };
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

  const pending = events.filter((event) => !cache[cacheKey(event)]);
  console.log(
    `  ${events.length - pending.length} already tagged, ${pending.length} to tag`,
  );

  let cost = 0;
  let failed = false;

  if (pending.length && !apiKey) {
    console.log("  ! OPENROUTER_API_KEY is not set — using keyword fallback");
    failed = true;
  }

  if (pending.length && apiKey) {
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const label = `  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pending.length / BATCH_SIZE)}`;
      try {
        const result = await tagBatch(batch, apiKey);
        batch.forEach((event, j) => {
          const tags = result.tags[j].filter((tag) => ALLOWED.has(tag));
          if (tags.length) {
            cache[cacheKey(event)] = { tags, model: MODEL, taggedAt: TODAY_ISO };
          }
        });
        cost += result.cost;
        console.log(`${label} ✓ ${batch.length} listings`);
      } catch (err) {
        failed = true;
        console.log(`${label} ✗ ${err.message} — keyword fallback for these`);
      }
    }
  }

  let fromModel = 0;
  let fromKeywords = 0;
  const tagged = events.map((event) => {
    const hit = cache[cacheKey(event)];
    if (hit) fromModel++;
    else fromKeywords++;
    return { ...event, tags: combine(event, hit ? hit.tags : fallbackTags(event)) };
  });

  const changed = tagged.filter(
    (event, i) => (events[i].tags || []).join() !== event.tags.join(),
  );

  console.log(
    `\n  ${fromModel} tagged by model, ${fromKeywords} by keyword fallback`,
  );
  console.log(`  ${changed.length} listings changed tags`);
  for (const event of changed.slice(0, 15)) {
    const before = events.find((e) => e.id === event.id);
    console.log(
      `    ${event.title.slice(0, 42).padEnd(42)} ${(before.tags || []).join("/") || "—"} → ${event.tags.join("/")}`,
    );
  }
  if (changed.length > 15) console.log(`    …and ${changed.length - 15} more`);
  if (cost) console.log(`  cost: $${cost.toFixed(5)}`);

  if (dryRun) {
    console.log("\n  (dry run — nothing written)");
    return;
  }

  fs.writeFileSync(EVENTS_FILE, JSON.stringify(tagged, null, 2) + "\n");
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
  console.log(
    `\n  ✓ Wrote ${path.basename(EVENTS_FILE)} and ${path.basename(CACHE_FILE)}`,
  );
  if (failed) {
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

module.exports = { TAGS, STRUCTURAL, combine, fallbackTags, cacheKey };
