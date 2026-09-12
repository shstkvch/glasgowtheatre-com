const test = require("node:test");
const assert = require("node:assert");
const {
  weekOf,
  nextWeek,
  selectShows,
  runBar,
  runLabel,
  priceLabel,
} = require("../scripts/build-social.js");

const MON = "2026-09-14";
const SUN = "2026-09-20";
const show = (date, endDate, extra = {}) => ({
  id: date + (endDate || ""),
  title: "A Show",
  venueId: "tron",
  date,
  endDate,
  opens: date >= MON && date <= SUN,
  ...extra,
});

test("the week a post covers", () => {
  assert.equal(weekOf("2026-09-11"), "2026-09-07", "Friday belongs to its own Monday");
  assert.equal(weekOf("2026-09-14"), "2026-09-14", "a Monday is its own Monday");
  assert.equal(weekOf("2026-09-20"), "2026-09-14", "Sunday still belongs to the Monday before");
  assert.equal(nextWeek("2026-09-11"), "2026-09-14", "seen from Friday, the coming week");
  assert.equal(nextWeek("2026-09-14"), "2026-09-14", "on the Monday itself, today");
});

test("a run's label names both ends", () => {
  assert.equal(runLabel(show("2026-09-18", null), MON, SUN), "Fri 18", "one night is one date");
  assert.equal(
    runLabel(show("2026-09-15", "2026-09-19"), MON, SUN),
    "Tue 15 – Sat 19",
    "a run inside the week needs no month",
  );
  assert.equal(
    runLabel(show("2026-09-18", "2026-10-10"), MON, SUN),
    "Fri 18 – Sat 10 Oct",
    "an end past Sunday carries its month",
  );
  assert.equal(
    runLabel(show("2026-09-10", "2026-09-19"), MON, SUN),
    "Thu 10 Sep – Sat 19",
    "a start before Monday carries its month",
  );
  assert.equal(
    runLabel(show("2026-08-29", "2026-09-26"), MON, SUN),
    "Sat 29 Aug – Sat 26 Sep",
    "a run spanning the week names both ends in full",
  );
  assert.equal(
    runLabel(show("2026-12-20", "2027-01-03"), "2026-12-21", "2026-12-27"),
    "Sun 20 Dec – Sun 3 Jan 2027",
    "a run into the next year says which year",
  );
});

test("the week's window catches overlapping runs", () => {
  const events = [
    show("2026-09-13", "2026-09-14"), // ends on the Monday
    show("2026-09-20", null), // the Sunday itself
    show("2026-09-21", null), // next Monday, too late
    show("2026-09-13", null), // the Sunday before, too early
    show("2026-08-01", "2026-12-01"), // straight through
  ];
  const ids = selectShows(events, MON).all.map((e) => e.date);
  assert.deepEqual(
    ids.sort(),
    ["2026-08-01", "2026-09-13", "2026-09-20"],
    "a run touching the window is in it; one either side is not",
  );
});

test("nothing is left out, but the running order decides", () => {
  // Deliberately in the wrong order, one venue each so venue spread cannot
  // be what sorts them.
  const events = [
    show("2026-09-15", null, { tags: ["community-event"], venueId: "a", id: "community" }),
    show("2026-09-15", null, { tags: ["workshop"], venueId: "b", id: "workshop" }),
    show("2026-09-15", null, { tags: ["stand-up"], venueId: "c", id: "comedy" }),
    show("2026-09-15", null, { tags: ["spoken-word"], venueId: "d", id: "poetry" }),
    show("2026-09-15", null, { tags: ["opera"], venueId: "e", id: "opera" }),
    show("2026-09-15", null, { tags: ["musical"], venueId: "f", id: "musical" }),
    show("2026-09-15", null, { tags: ["play"], venueId: "g", id: "play" }),
    show("2026-09-15", null, { tags: ["tour"], venueId: "h", id: "tour" }),
  ];
  const order = selectShows(events, MON).chosen.map((e) => e.id);
  assert.deepEqual(
    order,
    ["play", "musical", "opera", "poetry", "comedy", "workshop", "tour", "community"],
    "plays first and community events last, with none of them dropped",
  );
});

test("within a form, what opens this week leads", () => {
  const events = [
    show("2026-08-01", "2026-10-01", { tags: ["play"], venueId: "a", id: "running" }),
    show("2026-09-17", null, { tags: ["play"], venueId: "b", id: "opening-late" }),
    show("2026-09-15", null, { tags: ["play"], venueId: "c", id: "opening-early" }),
  ];
  const order = selectShows(events, MON).chosen.map((e) => e.id);
  assert.deepEqual(order, ["opening-early", "opening-late", "running"]);
});

test("one event per venue before any venue gets a second", () => {
  const events = [
    show("2026-09-15", null, { tags: ["play"], venueId: "tron", id: "tron-play" }),
    show("2026-09-16", null, { tags: ["play"], venueId: "tron", id: "tron-play-2" }),
    show("2026-09-17", null, { tags: ["tour"], venueId: "citizens", id: "citz-tour" }),
  ];
  const order = selectShows(events, MON).chosen.map((e) => e.id);
  assert.deepEqual(
    order,
    ["tron-play", "citz-tour", "tron-play-2"],
    "a tour at a second venue outranks a second play at the first",
  );
});

test("the tally counts the week, not the slides", () => {
  const events = [
    show("2026-09-15", null, { tags: ["play"], venueId: "tron", id: "1" }),
    show("2026-09-16", null, { tags: ["play"], venueId: "tron", id: "2" }),
    show("2026-09-17", null, { tags: ["tour"], venueId: "citizens", id: "3" }),
  ];
  const { tally } = selectShows(events, MON, 1);
  assert.deepEqual(tally, { events: 3, venues: 2 }, "all three, at two venues");
});

test("a bar is cut flat where the run leaves the week", () => {
  assert.deepEqual(runBar(show("2026-09-15", "2026-09-19"), MON, SUN), {
    from: 1,
    span: 5,
    openLeft: false,
    openRight: false,
  });
  const through = runBar(show("2026-08-29", "2026-10-10"), MON, SUN);
  assert.deepEqual(through, { from: 0, span: 7, openLeft: true, openRight: true });
});

test("prices keep their pence", () => {
  assert.equal(priceLabel({ from: 23.5 }), "From £23.50");
  assert.equal(priceLabel({ from: 14 }), "From £14");
  assert.equal(priceLabel({ from: 14, concession: 5 }), "From £14 (conc. £5)");
  assert.equal(priceLabel({ payWhatYouLike: true }), "Pay what you like");
  assert.equal(priceLabel(null), null, "no price published says nothing at all");
  assert.equal(
    priceLabel({ free: true, from: 0, text: "Free" }),
    "Free",
    "a venue that says free is free",
  );
  assert.equal(
    priceLabel({ free: false, from: 0, text: "Standard Price : 0.00" }),
    null,
    "a zero out of a box-office placeholder is not a free ticket",
  );
});
