/**
 * The swim-lane timeline behind /calendar.html: a lane per venue, a column
 * per day, and a bar per run. Build-time only — the published page is static
 * HTML, so nothing here ships to the browser.
 */
const DAY = 86400000;
/** How far ahead the timeline runs. Beyond this, listings are too sparse
    to be worth the scrolling. */
const MAX_DAYS = 189;
/** A one-night show is a single narrow bar, so its title has to sit in the
    space beside it. Reserving a few days of the track keeps that space
    clear instead of letting the next show butt up against the words. */
const LABEL_DAYS = 5;
/** Beyond this a title is long enough to be cut with an ellipsis rather
    than allowed to trail across an empty fortnight. */
const LABEL_MAX = 13;
// Midnight UTC, so a day number is exact and no rounding can nudge a date
// into the column next door.
const toDay = (iso) => Date.parse(iso + "T00:00:00Z") / DAY;
const toISO = (day) => new Date(day * DAY).toISOString().slice(0, 10);
/** Monday on or before the given date, so weekend shading and week rules
    can repeat every seven columns without an offset. */
function weekStart(iso) {
  const day = toDay(iso);
  const weekday = (((day + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday.
  return day - weekday;
}
/**
 * Lays shows out on one track per venue, adding tracks only where shows
 * overlap. Longest runs are placed first so they take the top track and
 * the lane reads as a season rather than a scatter.
 */
function packTracks(items) {
  const tracks = [];
  const ordered = [...items].sort(
    (a, b) =>
      a.start - b.start || b.span - a.span || a.title.localeCompare(b.title),
  );
  for (const item of ordered) {
    const reserved = Math.max(item.span, LABEL_DAYS);
    const track =
      tracks.find((t) => t.free <= item.start) ||
      tracks[tracks.push({ free: 0, items: [] }) - 1];
    track.items.push(item);
    track.free = item.start + reserved;
  }
  // Room is the gap before whatever comes next: how far a title may run
  // before it would collide with the following show on the same track.
  for (const track of tracks)
    track.items.forEach((item, i) => {
      const next = track.items[i + 1];
      const gap = (next ? next.start : Infinity) - item.start;
      item.room = Math.min(gap, Math.max(item.span, LABEL_MAX));
    });
  return tracks.map((track) => track.items);
}
/**
 * Turns listings into the swim-lane timeline: a column per day, a lane per
 * venue, and a bar per show clipped to the window it can be drawn in.
 */
function buildTimeline(events, venues, { today, maxDays = MAX_DAYS } = {}) {
  const first = weekStart(today);
  const ends = events.map((e) => toDay(e.endDate || e.date));
  const last = Math.min(
    first + maxDays - 1,
    Math.max(first + 27, ...(ends.length ? ends : [])),
  );
  const columns = last - first + 1;
  const inWindow = events.filter(
    (e) => toDay(e.endDate || e.date) >= first && toDay(e.date) <= last,
  );
  const days = Array.from({ length: columns }, (_, i) => {
    const iso = toISO(first + i);
    return {
      iso,
      date: Number(iso.slice(8)),
      weekday: i % 7,
      weekend: i % 7 > 4,
      today: iso === today,
    };
  });
  const months = [];
  days.forEach((day, i) => {
    const key = day.iso.slice(0, 7);
    const current = months[months.length - 1];
    if (current && current.key === key) current.span++;
    else months.push({ key, start: i, span: 1 });
  });
  const lanes = venues
    .map((venue) => {
      const own = inWindow.filter((e) => e.venueId === venue.id);
      const items = own.map((event) => {
        const from = toDay(event.date);
        const to = toDay(event.endDate || event.date);
        const start = Math.max(from, first);
        return {
          event,
          title: event.title,
          start: start - first,
          span: Math.min(to, last) - start + 1,
          openStart: from < first,
          openEnd: to > last,
        };
      });
      return { venue, count: own.length, tracks: packTracks(items) };
    })
    // A lane with nothing in it is a row of empty grid, so it is left out.
    .filter((lane) => lane.count)
    // Busiest venues first: the timeline opens on the stages with the most
    // to show rather than on whatever order the venue file happens to be in.
    .sort(
      (a, b) => b.count - a.count || a.venue.name.localeCompare(b.venue.name),
    );
  return {
    from: toISO(first),
    to: toISO(last),
    columns,
    todayIndex: toDay(today) - first,
    days,
    months,
    lanes,
    shows: inWindow.length,
  };
}
module.exports = { buildTimeline, packTracks, weekStart, toDay, toISO };
