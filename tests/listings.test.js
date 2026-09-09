const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  filterEvents,
  londonDate,
  mergeListings,
} = require("../src/js/listings.js");
const run = {
  id: "run",
  title: "Thrice",
  venueId: "tramway",
  date: "2026-10-16",
  endDate: "2026-10-17",
  tags: ["dance", "experimental"],
  ticketUrl: "https://example.com/thrice",
};
test("a date search includes a production already in progress", () => {
  assert.equal(
    filterEvents([run], { from: "2026-10-17", today: "2026-10-01" }).length,
    1,
  );
});
test("completed productions expire and the final day remains visible", () => {
  assert.equal(filterEvents([run], { today: "2026-10-17" }).length, 1);
  assert.equal(filterEvents([run], { today: "2026-10-18" }).length, 0);
});
test("filters compose and unknown queries have no results", () => {
  assert.equal(
    filterEvents([run], {
      today: "2026-09-09",
      query: "thrice",
      venue: "tramway",
      tag: "dance",
    }).length,
    1,
  );
  assert.equal(
    filterEvents([run], { today: "2026-09-09", query: "missing" }).length,
    0,
  );
  assert.equal(
    filterEvents([run], { today: "2026-09-09", tag: "comedy" }).length,
    0,
  );
});
test("the calendar day is Glasgow time during British Summer Time", () => {
  assert.equal(londonDate(new Date("2026-09-09T23:30:00Z")), "2026-09-10");
});
test("manual submission overrides scraper duplicate by booking URL", () => {
  const manual = {
    ...run,
    accessibility: "BSL interpreted by Lisa Li",
    image: "/images/thrice.webp",
  };
  const result = mergeListings(
    [{ ...run, title: "Al Seed Productions - Thrice" }],
    [manual],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].accessibility, manual.accessibility);
  assert.equal(result[0].image, manual.image);
});
const { parseTime, parseDateRange } = require("../scripts/scrape-events");
test("venue time formats include dots and hour-only times", () => {
  assert.equal(parseTime("7.30pm - 8.30pm"), "19:30");
  assert.equal(parseTime("Monday – Saturday 1pm"), "13:00");
  assert.equal(parseTime("Times vary"), null);
});
test("ISO dates and UK date ranges parse without truncating the year", () => {
  assert.deepEqual(parseDateRange("2026-10-16"), {
    startDate: "2026-10-16",
    endDate: null,
  });
  assert.deepEqual(parseDateRange("16th - 17th Oct 2026"), {
    startDate: "2026-10-16",
    endDate: "2026-10-17",
  });
});
test("a reversed date interval never returns a long-running show", () => {
  assert.deepEqual(
    filterEvents([run], {
      today: "2026-09-09",
      from: "2026-10-17",
      to: "2026-10-16",
    }),
    [],
  );
});
test('genre classification does not confuse a family in the story with a family show', () => {
  const { classifyTags } = require('../scripts/scrape-events');
  assert.equal(classifyTags('1984', 'Children spy on their parents. A family under surveillance.', 'professional').includes('family'), false);
  assert.equal(classifyTags('Improvising Life and Music', 'Music for a Scottish audience.', 'professional').includes('comedy'), false);
});
