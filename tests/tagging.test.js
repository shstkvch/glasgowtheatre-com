const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  FORMS,
  STRUCTURAL,
  combine,
  fallbackForm,
  cacheKey,
  needsScopeCheck,
} = require("../scripts/tag-events.js");
const { filterEvents } = require("../src/js/listings.js");

test("a listing carries exactly one art form", () => {
  // The old vocabulary let a listing be a comedy and a musical and a drama at
  // once, which is what made the filter pills meaningless.
  const tags = combine({ title: "Six", tags: [] }, "musical");
  assert.deepEqual(tags, ["musical"]);
});

test("the form leads, and the scraper's structural tags follow it", () => {
  const tags = combine(
    { title: "Transparent", tags: ["lunchtime", "a-play-a-pie-a-pint"] },
    "play",
  );
  assert.equal(tags[0], "play");
  assert.ok(tags.includes("lunchtime"));
  assert.ok(tags.includes("a-play-a-pie-a-pint"));
});

test("an invented form is replaced rather than published", () => {
  const tags = combine({ title: "Antigone", description: "A Greek tragedy", tags: [] }, "tragedy");
  assert.ok(FORMS[tags[0]], tags[0]);
});

test("structural tags are outside the form vocabulary", () => {
  // Otherwise the model could pick one as a form and lose the real answer.
  for (const tag of STRUCTURAL) assert.ok(!(tag in FORMS), tag);
});

test("stand-up and pantomime are separate forms", () => {
  // They were both "comedy" before, so filtering for a night of stand-up
  // returned a children's pantomime.
  assert.ok("stand-up" in FORMS);
  assert.ok("pantomime" in FORMS);
});

test("the keyword fallback always yields one real form", () => {
  const events = [
    { title: "Improv Comedy Night", description: "Funny stuff", type: "professional" },
    { title: "Antigone", description: "A Greek tragedy", type: "professional" },
    { title: "A ceilidh in Glasgow, Scotland", description: "Scottish music", type: "professional" },
    { title: "Untitled", description: "", type: "community" },
  ];
  for (const event of events) {
    const form = fallbackForm(event);
    assert.ok(FORMS[form], `${event.title}: ${form}`);
  }
});

test("only mixed-programme venues are asked whether they belong", () => {
  assert.equal(needsScopeCheck({ venueId: "citizens", sourceGenre: null }), false);
  assert.equal(needsScopeCheck({ venueId: "old-hairdressers", sourceGenre: null }), true);
});

test("the cache key follows the text, so an edited description is reclassified", () => {
  const event = { title: "A", venue: "B", description: "C" };
  assert.equal(cacheKey(event), cacheKey({ ...event }));
  assert.notEqual(cacheKey(event), cacheKey({ ...event, description: "D" }));
});

test("a season name is searchable, so a festival name finds its shows", () => {
  const event = {
    id: "season-show",
    title: "The Whaler’s Wife",
    venue: "Tron Theatre",
    venueId: "tron",
    season: "Mayfesto",
    date: "2026-10-01",
    tags: ["play"],
  };
  const found = filterEvents([event], { today: "2026-09-01", query: "mayfesto" });
  assert.equal(found.length, 1);
});

test("fallback separates forms without reviving genre tags", () => {
  const { classifyTags } = require("../scripts/scrape-events");
  for (const [title, description, expected] of [
    ["A funny musical", "A comedy with songs carrying the story", "musical"],
    ["Cinderella", "A funny family pantomime", "pantomime"],
    ["Turandot", "Puccini's opera", "opera"],
    ["Comedy night", "Stand-up from three comedians", "stand-up"],
    ["1984", "A play about a family under surveillance", "play"],
    ["Workshop", "A participatory dance workshop", "workshop"],
    ["Building and Heritage Tours", "Explore backstage", "tour"],
    ["Scottish Opera - Alcina Pre Show Talk", "Meet the production team", "talk"],
    ["Scottish Opera - Fidelio - Touch Tour", "Explore the set", "tour"],
  ]) {
    assert.equal(fallbackForm({ title, description }), expected, title);
    assert.deepEqual(classifyTags(title, description), [expected], title);
  }
});

test("fallback preserves an existing classification during an API outage", () => {
  assert.equal(fallbackForm({ title: "A funny musical", form: "pantomime" }), "pantomime");
});

test("the last-resort guess follows what the venue programmes", () => {
  // A listing the keywords cannot place used to become a play wherever it was,
  // so a gig at the Glad Cafe was published at the top of the plays filter.
  const listing = { title: "Locust + Mock Uncle", description: "Mark Van Hoen's project." };
  assert.equal(fallbackForm(listing), "play");
  assert.equal(fallbackForm(listing, { mixedProgramme: true }), "music");
});

test("all saved listings have one form and only source metadata alongside it", () => {
  const events = [...require("../data/events.json"), ...require("../data/manual-events.json")];
  for (const event of events) {
    assert.ok(Object.hasOwn(FORMS, event.form), event.title);
    assert.deepEqual(event.tags, combine(event, event.form), event.title);
  }
});

// --- Getting an answer at all ---
//
// Three gigs were published as plays because one request in a batch of twelve
// did not come back. Nothing retried it, and nothing said so: the listings
// took the keyword fallback's last resort, which is a guess.

const {
  tagBatch,
  askAbout,
  ATTEMPTS,
} = require("../scripts/tag-events.js");

const gig = (title) => ({
  id: title,
  title,
  venue: "The Glad Cafe",
  venueId: "glad-cafe",
  description: "A band playing its own songs.",
});

/** Stands in for OpenRouter, replying however each test needs. */
function stubAPI(replies) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.messages[1].content);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return {
      ok: true,
      json: async () => ({
        usage: { cost: 0.0001, prompt_tokens: 100, completion_tokens: 10 },
        choices: [
          { finish_reason: "stop", message: { content: JSON.stringify(reply) } },
        ],
      }),
    };
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

const answers = (forms) => ({
  results: forms.map((form, index) => ({
    index,
    form,
    inScope: form !== "music",
    scopeReason: form === "music" ? "Gig." : "",
  })),
});

test("a response that skips a listing is a failure, not a partial success", async () => {
  // It used to pass: the run logged a tick, billed for the batch, and the
  // unanswered listings quietly took a keyword guess.
  const api = stubAPI([
    { results: [{ index: 0, form: "music", inScope: false, scopeReason: "Gig." }] },
  ]);
  try {
    await assert.rejects(
      () => tagBatch([gig("Locust"), gig("Mock Uncle")], "key"),
      /answered 1 of 2/,
    );
  } finally {
    api.restore();
  }
});

test("a transient failure is retried rather than costing the batch its tags", async () => {
  const api = stubAPI([new Error("fetch failed"), answers(["music", "music"])]);
  const ctx = { cache: {}, cost: 0, promptTokens: 0, completionTokens: 0, abandoned: 0, retryDelayMs: 0 };
  try {
    await askAbout([gig("Locust"), gig("Mock Uncle")], "key", "  batch", ctx);
  } finally {
    api.restore();
  }
  assert.equal(api.calls.length, 2);
  assert.equal(ctx.abandoned, 0);
  assert.equal(Object.keys(ctx.cache).length, 2);
  for (const entry of Object.values(ctx.cache)) {
    assert.equal(entry.form, "music");
    assert.equal(entry.inScope, false);
  }
});

test("a group that will not answer is halved, so one listing cannot sink the rest", async () => {
  // The first group and its first half keep failing; the second half answers.
  const api = stubAPI([
    ...Array(ATTEMPTS).fill(new Error("HTTP 500")),
    ...Array(ATTEMPTS).fill(new Error("HTTP 500")),
    answers(["music"]),
  ]);
  const ctx = { cache: {}, cost: 0, promptTokens: 0, completionTokens: 0, abandoned: 0, retryDelayMs: 0 };
  try {
    await askAbout([gig("Bad"), gig("Good")], "key", "  batch", ctx);
  } finally {
    api.restore();
  }
  assert.equal(ctx.abandoned, 1);
  assert.equal(Object.keys(ctx.cache).length, 1);
  assert.equal(Object.values(ctx.cache)[0].form, "music");
});

test("an outage stops the run asking rather than waiting out every batch", async () => {
  const api = stubAPI([new Error("fetch failed")]);
  const ctx = { cache: {}, cost: 0, promptTokens: 0, completionTokens: 0, abandoned: 0, retryDelayMs: 0 };
  try {
    await askAbout([gig("One")], "key", "  batch 1", ctx);
    await askAbout([gig("Two")], "key", "  batch 2", ctx);
    const spent = api.calls.length;
    await askAbout([gig("Three")], "key", "  batch 3", ctx);
    assert.equal(api.calls.length, spent, "kept calling after giving up twice");
  } finally {
    api.restore();
  }
  assert.deepEqual(ctx.cache, {});
});
