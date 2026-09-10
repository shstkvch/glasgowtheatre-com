const test = require("node:test");
const assert = require("node:assert");
const { buildTimeline, weekStart, toISO } = require("../scripts/calendar");

const venues = [
  { id: "tron", name: "Tron Theatre", area: "Merchant City" },
  { id: "citz", name: "Citizens Theatre", area: "Gorbals" },
  { id: "empty", name: "Nowhere", area: "Nowhere" },
];
const show = (id, venueId, date, endDate) => ({
  id,
  title: id,
  venue: venueId,
  venueId,
  date,
  endDate,
});

test("the window starts on the Monday of the current week", () => {
  assert.equal(toISO(weekStart("2026-09-10")), "2026-09-07"); // a Thursday
  assert.equal(toISO(weekStart("2026-09-07")), "2026-09-07"); // already Monday
  assert.equal(toISO(weekStart("2026-09-13")), "2026-09-07"); // a Sunday
});

test("days, weekends and today line up with the columns", () => {
  const view = buildTimeline(
    [show("a", "tron", "2026-09-10", "2026-09-12")],
    venues,
    { today: "2026-09-10" },
  );
  assert.equal(view.from, "2026-09-07");
  assert.equal(view.todayIndex, 3);
  assert.equal(view.days[view.todayIndex].today, true);
  assert.deepEqual(
    view.days.slice(0, 7).map((d) => d.weekend),
    [false, false, false, false, false, true, true],
  );
  assert.equal(view.columns, view.days.length);
});

test("a run is as many columns wide as it is days long", () => {
  const [lane] = buildTimeline(
    [show("a", "tron", "2026-09-10", "2026-09-12"), show("b", "tron", "2026-09-30")],
    venues,
    { today: "2026-09-10" },
  ).lanes;
  const [long, single] = lane.tracks[0];
  assert.equal(long.start, 3);
  assert.equal(long.span, 3);
  assert.equal(single.span, 1);
  assert.equal(single.start, 23);
});

test("a run already under way is clipped to the window and flagged as open", () => {
  const [lane] = buildTimeline(
    [show("a", "tron", "2026-06-01", "2026-09-20")],
    venues,
    { today: "2026-09-10" },
  ).lanes;
  const [item] = lane.tracks[0];
  assert.equal(item.start, 0);
  assert.equal(item.openStart, true);
  assert.equal(item.openEnd, false);
});

test("a run past the far edge is clipped and flagged there too", () => {
  const view = buildTimeline(
    [show("a", "tron", "2026-09-10", "2027-12-01")],
    venues,
    { today: "2026-09-10", maxDays: 28 },
  );
  const [item] = view.lanes[0].tracks[0];
  assert.equal(view.columns, 28);
  assert.equal(item.span, 28 - 3);
  assert.equal(item.openEnd, true);
});

test("overlapping runs stack onto separate tracks, clear runs share one", () => {
  const overlapping = buildTimeline(
    [
      show("a", "tron", "2026-09-14", "2026-09-20"),
      show("b", "tron", "2026-09-16", "2026-09-18"),
    ],
    venues,
    { today: "2026-09-10" },
  ).lanes[0];
  assert.equal(overlapping.tracks.length, 2);
  const sequential = buildTimeline(
    [
      show("a", "tron", "2026-09-14", "2026-09-20"),
      show("b", "tron", "2026-10-01", "2026-10-04"),
    ],
    venues,
    { today: "2026-09-10" },
  ).lanes[0];
  assert.equal(sequential.tracks.length, 1);
});

test("a short run keeps room beside it for its title", () => {
  const lane = buildTimeline(
    [show("a", "tron", "2026-09-14"), show("b", "tron", "2026-09-16")],
    venues,
    { today: "2026-09-10" },
  ).lanes[0];
  // Two one-night shows two days apart cannot share a track, because the
  // first one's title needs the space the second would sit in.
  assert.equal(lane.tracks.length, 2);
  const alone = buildTimeline([show("a", "tron", "2026-09-14")], venues, {
    today: "2026-09-10",
  }).lanes[0];
  assert.ok(alone.tracks[0][0].room > alone.tracks[0][0].span);
});

test("a title never runs into the show that follows it", () => {
  const [track] = buildTimeline(
    [
      show("a", "tron", "2026-09-14"),
      show("b", "tron", "2026-09-19"),
      show("c", "tron", "2026-09-28"),
    ],
    venues,
    { today: "2026-09-10" },
  ).lanes[0].tracks;
  assert.equal(track.length, 3);
  track.forEach((item, i) => {
    const next = track[i + 1];
    if (next) assert.ok(item.start + item.room <= next.start);
    assert.ok(item.room >= item.span);
  });
});

test("lanes lead with the busiest venue and drop the ones with nothing on", () => {
  const view = buildTimeline(
    [
      show("a", "tron", "2026-09-14"),
      show("b", "citz", "2026-09-14"),
      show("c", "citz", "2026-10-14"),
    ],
    venues,
    { today: "2026-09-10" },
  );
  assert.deepEqual(
    view.lanes.map((lane) => lane.venue.id),
    ["citz", "tron"],
  );
});

test("shows that finished before the window are left off the chart", () => {
  const view = buildTimeline(
    [show("old", "tron", "2026-08-01", "2026-08-30"), show("a", "tron", "2026-09-14")],
    venues,
    { today: "2026-09-10" },
  );
  assert.equal(view.shows, 1);
  assert.equal(view.lanes[0].count, 1);
});

test("an empty listing still produces a usable four-week grid", () => {
  const view = buildTimeline([], venues, { today: "2026-09-10" });
  assert.equal(view.columns, 28);
  assert.deepEqual(view.lanes, []);
  assert.equal(view.months[0].key, "2026-09");
});
