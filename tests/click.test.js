const test = require("node:test");
const assert = require("node:assert");
const {
  londonDay,
  parseEvent,
  safeEqual,
  shiftDay,
  summarise,
} = require("../functions/_lib/track-core");

const body = (overrides = {}) =>
  JSON.stringify({
    kind: "click",
    show: "tron-the-big-comedy-roadshow",
    venue: "tron",
    title: "The Big Comedy Roadshow",
    surface: "card",
    path: "/",
    ...overrides,
  });

test("a well-formed click becomes a row", () => {
  const row = parseEvent(body(), {
    country: "GB",
    now: new Date("2026-10-30T12:00:00Z"),
  });
  assert.equal(row.show, "tron-the-big-comedy-roadshow");
  assert.equal(row.kind, "click");
  assert.equal(row.venue, "tron");
  assert.equal(row.surface, "card");
  assert.equal(row.country, "GB");
  assert.equal(row.day, "2026-10-30");
});

test("anything the site could not have sent is dropped", () => {
  assert.equal(parseEvent("not json"), null);
  assert.equal(parseEvent("{}"), null);
  assert.equal(parseEvent(body({ kind: "purchase" })), null);
  assert.equal(parseEvent(body({ show: "Tron; DROP TABLE events" })), null);
  assert.equal(parseEvent(body({ show: "" })), null);
  assert.equal(parseEvent(body({ show: "x".repeat(200) })), null);
  assert.equal(parseEvent(JSON.stringify(body())), null);
  assert.equal(parseEvent("x".repeat(513)), null);
});

test("unknown surfaces become other rather than rejecting the click", () => {
  assert.equal(parseEvent(body({ surface: "popup" })).surface, "other");
  assert.equal(parseEvent(body({ venue: "Not A Venue" })).venue, null);
  assert.equal(parseEvent(body({ path: "/shows/x.html?q=secret" })).path, null);
});

test("the day is Glasgow's day, not UTC's", () => {
  const late = parseEvent(body(), { now: new Date("2026-07-01T23:30:00Z") });
  assert.equal(late.day, "2026-07-02");
  assert.equal(londonDay(new Date("2026-01-01T00:30:00Z")), "2026-01-01");
});

test("shiftDay crosses months and years", () => {
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDay("2026-10-30", -29), "2026-10-01");
});

test("summarise keeps today, the week, the month and all time apart", () => {
  const report = summarise({
    today: "2026-10-30",
    daily: [
      { day: "2026-10-30", show_id: "a", kind: "click", venue_id: "tron", title: "A", n: 2 },
      { day: "2026-10-30", show_id: "a", kind: "view", venue_id: "tron", title: "A", n: 5 },
      { day: "2026-10-24", show_id: "a", kind: "click", venue_id: "tron", title: "A", n: 3 },
      { day: "2026-09-01", show_id: "a", kind: "click", venue_id: "tron", title: "A", n: 7 },
      { day: "2026-10-29", show_id: "b", kind: "click", venue_id: "citizens", title: "B", n: 1 },
      { day: "2026-10-29", show_id: "b", kind: "view", venue_id: "citizens", title: "B", n: 10 },
    ],
    totals: [
      { show_id: "a", kind: "click", venue_id: "tron", title: "A", n: 12 },
      { show_id: "a", kind: "view", venue_id: "tron", title: "A", n: 40 },
      { show_id: "b", kind: "click", venue_id: "citizens", title: "B", n: 1 },
      { show_id: "b", kind: "view", venue_id: "citizens", title: "B", n: 10 },
    ],
  });

  const [first, second] = report.shows;
  assert.equal(first.id, "a");
  assert.deepEqual(first.clicks, { today: 2, week: 5, month: 5, all: 12 });
  assert.deepEqual(first.views, { today: 5, week: 5, month: 5, all: 40 });
  assert.deepEqual(second.clicks, { today: 0, week: 1, month: 1, all: 1 });
  assert.deepEqual(report.totals.week, { clicks: 6, views: 15 });
  assert.deepEqual(report.totals.all, { clicks: 13, views: 50 });
  assert.equal(report.windows.today, "2026-10-30");
});

test("the report sorts by the week, then all time", () => {
  const report = summarise({
    today: "2026-10-30",
    daily: [],
    totals: [
      { show_id: "old", kind: "click", title: "Old", n: 100 },
      { show_id: "new", kind: "click", title: "New", n: 1 },
    ],
  });
  assert.deepEqual(report.shows.map((show) => show.id), ["old", "new"]);
});

test("token comparison is exact", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual(null, "abc"), false);
});
