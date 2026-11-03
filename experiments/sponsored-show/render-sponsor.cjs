const { clockTime } = require('../../scripts/tickets');
const { formLabel } = require('../../scripts/art-forms');

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const money = pence => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);

// The normal listing anatomy, with a quiet disclosure beside the venue.
module.exports = function renderSponsor(selected, listing, surface) {
  const { show, performances } = selected;
  const next = performances[0];
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(`${next.date}T12:00:00Z`));
  const fixed = show.ticketing.ticket_types.filter(ticket => ticket.kind === 'fixed' && Number.isInteger(ticket.price));
  const minimum = Math.min(...fixed.map(ticket => ticket.price));
  const price = Number.isFinite(minimum) ? `From ${money(minimum)}` : `Pay What You Can from ${money(show.ticketing.pay_what_you_can_minimum)}`;
  const description = 'Brand-new play extracts, stand-up, poetry and music. Discover what Glasgow’s performers are working on next.';
  const tracking = `data-track-show="${escape(listing.id)}" data-track-venue="${escape(listing.venueId)}" data-track-title="${escape(show.title)}" data-track-surface="${escape(surface)}"`;
  const detail = `/shows/${escape(listing.id)}.html`;
  return `<article class="event-card sponsored-show" data-id="${escape(listing.id)}" id="sponsored-show" aria-labelledby="sponsor-title" hidden>
  <div class="event-card-image artwork-whole"><a class="event-card-thumb" href="${detail}" tabindex="-1" aria-hidden="true"><img src="/assets/working-it-out.webp" width="764" height="510" alt="" loading="lazy"></a><span class="date-stamp">${escape(day)}</span></div>
  <div class="event-card-body">
    <div class="card-topline"><div class="sponsor-venue"><a href="/venues/${escape(listing.venueId)}.html">Theatre 118</a><span class="sponsor-label">Sponsored</span></div><span>${escape(formLabel(listing.form))}</span></div>
    <h3 id="sponsor-title"><a href="${detail}">${escape(show.title)}</a></h3>
    <p class="card-when">${next.time ? `<span class="fact-time">${escape(clockTime(next.time))}</span>` : ''}<span class="fact-price">${escape(price)}</span></p>
    <p class="event-description">${escape(description)}</p>
    <div class="event-card-footer"><a class="detail-link" href="${detail}">Prices &amp; times</a><a class="ticket-link" href="${escape(show.url)}" rel="sponsored" ${tracking} aria-label="Tickets for ${escape(show.title)}">Tickets <span aria-hidden="true">↗</span></a></div>
  </div>
</article>`;
};
