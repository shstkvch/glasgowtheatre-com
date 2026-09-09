const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  TAGS,
  STRUCTURAL,
  combine,
  fallbackTags,
  cacheKey,
} = require("../scripts/tag-events.js");
const { filterEvents } = require("../src/js/listings.js");

test("a discussion about a play is a talk, not a drama", () => {
  // The model kept pairing these; combine() is what actually guarantees it.
  assert.deepEqual(combine({ tags: [] }, ["talk", "drama"]), ["talk"]);
  assert.deepEqual(combine({ tags: [] }, ["drama", "talk"]), ["talk"]);
});

test("workshops and tours crowd out performance genres too", () => {
  assert.deepEqual(combine({ tags: [] }, ["workshop", "drama"]), ["workshop"]);
  assert.deepEqual(combine({ tags: [] }, ["tour", "spoken-word"]), ["tour"]);
});

test("a performance keeps every genre the model chose", () => {
  assert.deepEqual(combine({ tags: [] }, ["drama", "classic"]), [
    "drama",
    "classic",
  ]);
});

test("tags the scraper set from the source survive retagging", () => {
  const event = { tags: ["a-play-a-pie-a-pint", "lunchtime", "scottish"] };
  const tags = combine(event, ["drama", "new-writing"]);
  assert.deepEqual(tags, [
    "drama",
    "new-writing",
    "a-play-a-pie-a-pint",
    "lunchtime",
  ]);
  // "scottish" is no longer in the vocabulary and must not come back.
  assert.ok(!tags.includes("scottish"));
});

test("invented tags are discarded", () => {
  assert.deepEqual(combine({ tags: [] }, ["immersive", "drama", "vibes"]), [
    "drama",
  ]);
});

test("no more than three genre tags reach a card", () => {
  const tags = combine({ tags: [] }, [
    "drama",
    "classic",
    "new-writing",
    "comedy",
    "dance",
  ]);
  assert.equal(tags.length, 3);
});

test("every structural tag is outside the model's vocabulary", () => {
  // Otherwise the model could silently drop one by not repeating it.
  for (const tag of STRUCTURAL) assert.ok(!(tag in TAGS), tag);
});

test("the keyword fallback only ever returns tags in the vocabulary", () => {
  const events = [
    { title: "Improv Comedy Night", description: "Funny stuff", type: "professional" },
    { title: "Antigone", description: "A Greek tragedy", type: "professional" },
    { title: "A ceilidh in Glasgow, Scotland", description: "Scottish music", type: "professional" },
    { title: "Untitled", description: "", type: "community" },
  ];
  for (const event of events) {
    const tags = fallbackTags(event);
    assert.ok(tags.length > 0, event.title);
    for (const tag of tags) assert.ok(tag in TAGS, `${event.title}: ${tag}`);
  }
});

test("the cache key follows the text, so an edited description is retagged", () => {
  const event = { title: "A", venue: "B", description: "C" };
  assert.equal(cacheKey(event), cacheKey({ ...event }));
  assert.notEqual(cacheKey(event), cacheKey({ ...event, description: "D" }));
});

test("a season name is searchable, so 'play pie' finds the lunchtime shows", () => {
  const event = {
    id: "ppp",
    title: "The Whaler’s Wife",
    venue: "Òran Mór",
    venueId: "oran-mor",
    season: "A Play, A Pie and A Pint",
    date: "2026-10-01",
    tags: ["drama"],
  };
  const found = filterEvents([event], {
    today: "2026-09-01",
    query: "a play, a pie",
  });
  assert.equal(found.length, 1);
});
