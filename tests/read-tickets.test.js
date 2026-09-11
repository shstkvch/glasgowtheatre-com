const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  sane,
  schedule,
  apply,
  needsReading,
  promptText,
} = require("../scripts/read-tickets");

/* The model itself is not tested here — it is a network call to somebody
   else's weights. What is tested is everything standing between it and a
   published page, because a cheap model is occasionally confident about
   nonsense and a wrong price is a promise the site cannot keep. */

const reading = (extra = {}) => ({
  from: 18,
  to: null,
  concession: null,
  free: false,
  payWhatYouLike: false,
  performances: [],
  days: [],
  time: null,
  byDay: null,
  ...extra,
});

test("a coherent reading survives intact", () => {
  const out = sane(reading({ to: 26, concession: 5 }));
  assert.equal(out.from, 18);
  assert.equal(out.to, 26);
  assert.equal(out.concession, 5);
});

test("a concession dearer than the full price is dropped, not swapped", () => {
  assert.equal(sane(reading({ concession: 30 })).concession, null);
  assert.equal(sane(reading({ concession: 18 })).concession, null);
});

test("a range that runs backwards loses its top", () => {
  assert.equal(sane(reading({ from: 20, to: 12 })).to, null);
});

test("prices outside anything a Glasgow theatre charges are refused", () => {
  assert.equal(sane(reading({ from: -5 })).from, null);
  assert.equal(sane(reading({ from: 4000 })).from, null);
  assert.equal(sane(reading({ from: "eighteen" })).from, null);
});

test("free means free: a price and a free flag cannot both stand", () => {
  assert.equal(sane(reading({ free: true })).free, false);
  assert.equal(sane(reading({ from: null, free: true })).free, true);
});

test("anything that is not a 24-hour time is not a time", () => {
  assert.equal(sane(reading({ time: "7.30pm" })).time, null);
  assert.equal(sane(reading({ time: "25:00" })).time, null);
  assert.equal(sane(reading({ time: "19:30" })).time, "19:30");
});

test("day names become day numbers and rubbish is discarded", () => {
  assert.deepEqual(sane(reading({ days: ["mon", "sat", "yesterday"] })).days, [1, 6]);
  assert.deepEqual(sane(reading({ days: ["tue", "tue"] })).days, [2]);
});

test("a per-day price list keeps only real days and real money", () => {
  assert.deepEqual(sane(reading({ byDay: { mon: 17, sat: 22.5, someday: 9 } })).byDay, {
    1: 17,
    6: 22.5,
  });
  assert.equal(sane(reading({ byDay: {} })).byDay, null);
});

const run = { date: "2026-09-28", endDate: "2026-10-03" };

test("a weekly pattern is expanded across the run it was published against", () => {
  const dates = schedule(
    run,
    sane(reading({ days: ["mon", "tue", "wed", "thu", "fri", "sat"], time: "13:00" })),
  );
  assert.equal(dates.length, 6);
  assert.equal(dates[0].date, "2026-09-28");
  assert.equal(dates[5].date, "2026-10-03");
  assert.ok(dates.every((d) => d.time === "13:00"));
});

test("a pattern with no end date is never expanded into a single lonely night", () => {
  // "Thu 3 Sep - Thu 17 Dec" whose listing lost its closing date: one Thursday
  // would read as the whole term, so the run keeps its published wording.
  assert.equal(
    schedule({ date: "2026-09-03", endDate: null }, sane(reading({ days: ["thu"], time: "17:30" }))),
    null,
  );
});

test("a run only plays the days the venue named", () => {
  const dates = schedule(run, sane(reading({ days: ["sat"], time: "19:30" })));
  assert.equal(dates, null); // one Saturday in the window is not a schedule
  const fortnight = schedule(
    { date: "2026-09-28", endDate: "2026-10-11" },
    sane(reading({ days: ["sat"], time: "19:30" })),
  );
  assert.deepEqual(
    fortnight.map((d) => d.date),
    ["2026-10-03", "2026-10-10"],
  );
});

test("prices that vary by day land on the right dates", () => {
  const dates = schedule(
    run,
    sane(
      reading({
        days: ["mon", "tue", "wed", "thu", "fri", "sat"],
        time: "13:00",
        byDay: { mon: 17, tue: 19, wed: 19, thu: 19, fri: 19, sat: 22.5 },
      }),
    ),
  );
  assert.equal(dates[0].price, 17); // Monday
  assert.equal(dates[5].price, 22.5); // Saturday
});

test("named dates beat a pattern and may run past the advertised close", () => {
  // Platform's "Fri 2 Oct @ 7pm & Sat 3 Oct @ 2pm & 7pm" against a listing
  // whose date range carried only the Friday.
  const event = { date: "2026-10-02", endDate: null };
  const named = sane(
    reading({
      performances: [
        { date: "2026-10-02", time: "19:00" },
        { date: "2026-10-03", time: "14:00" },
        { date: "2026-10-03", time: "19:00" },
      ],
    }),
  );
  assert.equal(schedule(event, named).length, 3);
  const out = apply({ ...event, pricing: null }, named);
  assert.equal(out.endDate, "2026-10-03");
  assert.equal(out.performances.length, 3);
});

test("a date the run cannot reach is refused", () => {
  const event = { date: "2026-10-02", endDate: null };
  const wandering = sane(
    reading({
      performances: [
        { date: "2026-10-02", time: "19:00" },
        { date: "2025-10-03", time: "19:00" },
        { date: "2027-10-03", time: "19:00" },
        { date: "not a date", time: "19:00" },
      ],
    }),
  );
  assert.deepEqual(
    schedule(event, wandering).map((p) => p.date),
    ["2026-10-02"],
  );
});

test("a schedule the venue published itself is never overwritten", () => {
  const published = {
    date: "2026-10-02",
    endDate: "2026-10-03",
    performances: [{ date: "2026-10-02", time: "19:30" }],
    pricing: null,
  };
  const out = apply(published, sane(reading({ days: ["fri", "sat"], time: "14:00" })));
  assert.deepEqual(out.performances, published.performances);
  // But one this pass worked out before can be replaced by a better reading.
  const ours = { ...published, scheduleRead: "model" };
  assert.equal(
    apply(ours, sane(reading({ days: ["fri", "sat"], time: "14:00" }))).performances.length,
    2,
  );
});

test("the venue's own wording is never rewritten by the reading of it", () => {
  const event = { date: "2026-10-02", pricing: { text: "£20/£12", from: 12, notes: "Fees apply" } };
  const out = apply(event, sane(reading({ from: 20, concession: 12 })));
  assert.equal(out.pricing.text, "£20/£12");
  assert.equal(out.pricing.notes, "Fees apply");
  assert.equal(out.pricing.from, 20);
  assert.equal(out.pricing.read, "model");
});

test("only listings with wording nobody can parse are sent to the model", () => {
  const structured = {
    pricing: { from: 19, to: 39, text: null },
    performances: [{ date: "2026-10-06", time: "19:30" }],
  };
  assert.equal(needsReading(structured), false);
  assert.equal(needsReading({ pricing: { text: "£20/£12" } }), true);
  assert.equal(needsReading({ scheduleText: "Monday – Saturday 1pm" }), true);
  assert.equal(needsReading({}), false);
});

test("the prompt carries the wording and the run, and nothing else", () => {
  const text = promptText({
    title: "Transparent",
    venue: "A Play, a Pie and a Pint",
    date: "2026-09-07",
    endDate: "2026-09-12",
    pricing: { text: "Monday: £17" },
    scheduleText: "Monday – Saturday 1pm",
    description: "A heartfelt new comedy about finding love later in life.",
  });
  assert.match(text, /RUNS: 2026-09-07 to 2026-09-12/);
  assert.match(text, /Monday: £17/);
  assert.match(text, /Monday – Saturday 1pm/);
  // The blurb is not evidence about the price and would only cost tokens and
  // invite the model to invent one from it.
  assert.doesNotMatch(text, /heartfelt/);
});
