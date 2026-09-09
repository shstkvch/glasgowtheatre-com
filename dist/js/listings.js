(function (root) {
  "use strict";
  function londonDate(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }
  function filterEvents(
    events,
    {
      today = londonDate(),
      from = "",
      to = "",
      venue = "",
      tag = "",
      query = "",
    } = {},
  ) {
    if (from && to && from > to) return [];
    const search = query.trim().toLocaleLowerCase();
    return events
      .filter(
        (e) =>
          (e.endDate || e.date) >= today &&
          (!from || (e.endDate || e.date) >= from) &&
          (!to || e.date <= to) &&
          (!venue || e.venueId === venue) &&
          (!tag || (e.tags || []).includes(tag)) &&
          (!search ||
            [e.title, e.venue, e.season, e.description, ...(e.tags || [])]
              .join(" ")
              .toLocaleLowerCase()
              .includes(search)),
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
      );
  }
  function mergeListings(scraped, manual) {
    const key = (e) => (e.ticketUrl ? e.ticketUrl.replace(/\/$/, "") : e.id);
    const entries = new Map(scraped.map((e) => [key(e), e]));
    manual.forEach((e) => entries.set(key(e), e));
    return [...entries.values()];
  }
  const api = { londonDate, filterEvents, mergeListings };
  if (typeof module !== "undefined") module.exports = api;
  else root.Listings = api;
})(typeof window !== "undefined" ? window : globalThis);
