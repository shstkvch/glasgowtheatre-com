(function (root) {
  'use strict';
  const londonClock = (now = new Date()) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  };

  function availablePerformances(show, now = new Date()) {
    if (show.ticketing?.on_sale !== true || show.ticketing?.external_url) return [];
    const clock = londonClock(now);
    return (show.performances || []).filter(performance => {
      // Missing inventory flags are unknown, rather than evidence of availability.
      if (performance.cancelled !== false || performance.sold_out !== false) return false;
      if (!/^https:\/\/theatre118\.com\//.test(performance.booking_url || '')) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(performance.date || '')) return false;
      if (performance.date > clock.date) return true;
      // A same-day performance with no curtain time cannot be proven upcoming.
      return performance.date === clock.date && /^\d{2}:\d{2}$/.test(performance.time || '') && performance.time > clock.time;
    }).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '23:59').localeCompare(b.time || '23:59'));
  }

  function selectSponsoredShow(feed, now = new Date()) {
    return (feed.shows || []).map(show => ({ show, performances: availablePerformances(show, now) }))
      .filter(candidate => candidate.performances.length)
      .sort((a, b) => {
        const first = a.performances[0];
        const second = b.performances[0];
        return first.date.localeCompare(second.date) ||
          (first.time || '23:59').localeCompare(second.time || '23:59') || String(a.show.id).localeCompare(String(b.show.id));
      })[0] || null;
  }

  function matchesSponsor(candidate, listing, filters, filterEvents, now = new Date()) {
    if (!candidate || !listing) return false;
    if (candidate.show.url !== listing.ticketUrl) return false;
    if (!filterEvents([listing], { ...filters, today: londonClock(now).date }).length) return false;
    // A matching run is not enough when its only bookable sitting falls outside
    // the selected dates. Never promote an unavailable night inside that run.
    return availablePerformances(candidate.show, now).some(performance =>
      (!filters.from || performance.date >= filters.from) && (!filters.to || performance.date <= filters.to));
  }

  const api = { londonClock, availablePerformances, selectSponsoredShow, matchesSponsor };
  if (typeof module !== 'undefined') module.exports = api;
  else root.SponsoredShow = api;
})(typeof window !== 'undefined' ? window : globalThis);
