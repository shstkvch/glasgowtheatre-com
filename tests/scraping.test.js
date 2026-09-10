const test = require("node:test");
const assert = require("node:assert");

const { parseDateRange, platformDates } = require("../scripts/scrape-events.js");
const { needsScopeCheck } = require("../scripts/tag-events.js");
const { troubleLines, summaryLines } = require("../scripts/report-new.js");

const TODAY = new Date().toISOString().slice(0, 10);

test("'Until' is a run already open, not a show opening on its closing night", () => {
  // ATG writes an in-progress run this way. Read literally, Burlesque would
  // have been listed as opening on the day it closes.
  const { startDate, endDate } = parseDateRange("Until Sat 19 Sep 2026");
  assert.strictEqual(startDate, TODAY);
  assert.strictEqual(endDate, "2026-09-19");
});

test("ATG's date shapes all parse", () => {
  assert.deepStrictEqual(parseDateRange("Mon 21 Sep 2026"), {
    startDate: "2026-09-21",
    endDate: null,
  });
  assert.deepStrictEqual(parseDateRange("Tue 22 Sep - Wed 23 Sep 2026"), {
    startDate: "2026-09-22",
    endDate: "2026-09-23",
  });
  // A run crossing the new year carries both years.
  assert.deepStrictEqual(parseDateRange("Sat 21 Nov 2026 - Sun 3 Jan 2027"), {
    startDate: "2026-11-21",
    endDate: "2027-01-03",
  });
});

test("Platform's year comes from the item's class names, not the date text", () => {
  const years = { sep: "2026", nov: "2026" };
  assert.deepStrictEqual(platformDates("Sat 19 Sep - Sat 28 Nov", years), {
    startDate: "2026-09-19",
    endDate: "2026-11-28",
  });
});

test("Platform's day-only range borrows the month from the end", () => {
  assert.deepStrictEqual(platformDates("Mon 12 - Fri 16 Oct", { oct: "2026" }), {
    startDate: "2026-10-12",
    endDate: "2026-10-16",
  });
});

test("Platform times are dropped before the date is parsed", () => {
  assert.strictEqual(
    platformDates("Fri 2 Oct @ 7pm & Sat 3 Oct @ 2pm & 7pm", { oct: "2026" }).startDate,
    "2026-10-02",
  );
  assert.strictEqual(
    platformDates("Thu 15 Oct | 7pm", { oct: "2026" }).startDate,
    "2026-10-15",
  );
});

test("a listing with no date at all is skipped rather than guessed at", () => {
  assert.strictEqual(platformDates("Fridays | 12noon", {}).startDate, null);
  assert.strictEqual(platformDates("Various dates & times", {}).startDate, null);
});

test("only mixed-programme venues are asked whether they belong", () => {
  // Everything the Citizens stages is theatre by definition.
  assert.strictEqual(
    needsScopeCheck({ venueId: "citizens", sourceGenre: null }),
    false,
  );
  assert.strictEqual(
    needsScopeCheck({ venueId: "old-hairdressers", sourceGenre: null }),
    true,
  );
});

test("a source category that settles the question saves a verdict", () => {
  // ATG filing something under Musicals is good enough.
  assert.strictEqual(
    needsScopeCheck({ venueId: "kings", sourceGenre: "Musicals" }),
    false,
  );
  // "Concert" at a receiving house might be a staged song cycle or a gig.
  assert.strictEqual(
    needsScopeCheck({ venueId: "kings", sourceGenre: "Concert" }),
    true,
  );
});

test("a failed scrape and a failed structural check both reach the email", () => {
  const lines = troubleLines({
    failures: { tron: "HTTP 500" },
    canaries: { pavilion: ["eventCards missing"] },
  });
  assert.strictEqual(lines.length, 2);
  assert.ok(lines.some((l) => /tron: HTTP 500/.test(l)));
  assert.ok(lines.some((l) => /pavilion: eventCards missing/.test(l)));
});

test("a clean run reports no trouble", () => {
  assert.deepStrictEqual(troubleLines({ failures: {}, canaries: {} }), []);
  assert.deepStrictEqual(troubleLines(null), []);
});

test("a long exclusion list is summarised rather than dumped", () => {
  const excluded = Array.from({ length: 40 }, (_, i) => ({
    title: `Gig ${i}`,
    venue: "The Old Hairdressers",
    reason: "band gig",
  }));
  const lines = summaryLines(160, {
    refreshedAt: "2026-09-10T05:18:33Z",
    retainedVenues: [],
    tagging: { at: "2026-09-10T05:18:35Z", totalTokens: 0, costUsd: 0, excluded },
  });
  const text = lines.join("\n");
  assert.match(text, /Left off as not theatre: 40 \(The Old Hairdressers 40\)/);
  assert.match(text, /…and 32 more/);
  // The whole list must not end up in the email.
  assert.ok(lines.length < 15);
});
