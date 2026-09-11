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

test("all saved listings have one form and only source metadata alongside it", () => {
  const events = [...require("../data/events.json"), ...require("../data/manual-events.json")];
  for (const event of events) {
    assert.ok(Object.hasOwn(FORMS, event.form), event.title);
    assert.deepEqual(event.tags, combine(event, event.form), event.title);
  }
});
