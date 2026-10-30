const { clockTime } = require('../../scripts/tickets');
const { formLabel } = require('../../scripts/art-forms');

const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const money = pence => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);

// One creative shared by the homepage and the bottom of show detail pages.
module.exports = function renderSponsor(selected, listing, surface) {
  const { show, performances } = selected;
  const next = performances[0];
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(`${next.date}T12:00:00Z`));
  const fixed = show.ticketing.ticket_types.filter(ticket => ticket.kind === 'fixed' && Number.isInteger(ticket.price));
  const minimum = Math.min(...fixed.map(ticket => ticket.price));
  const price = Number.isFinite(minimum) ? `${money(minimum)} tickets` : `Pay What You Can from ${money(show.ticketing.pay_what_you_can_minimum)}`;
  const description = 'Brand-new play extracts, stand-up, poetry and music. Discover what Glasgow’s performers are working on next.';
  const tracking = `data-track-show="${escape(listing.id)}" data-track-venue="${escape(listing.venueId)}" data-track-title="${escape(show.title)}" data-track-surface="${escape(surface)}"`;
  return `<article class="sponsored-show" data-id="${escape(listing.id)}" id="sponsored-show" aria-labelledby="sponsor-title" hidden>
  <div class="sponsor-disclosure"><span class="sponsor-label">Sponsored Show</span><span>Paid placement by Theatre 118</span></div>
  <div class="sponsor-layout">
    <a class="sponsor-art" href="${escape(show.url)}" rel="sponsored" ${tracking} tabindex="-1" aria-hidden="true"><img src="/assets/working-it-out.webp" width="764" height="510" alt="" loading="lazy"></a>
    <div class="sponsor-copy"><p class="sponsor-venue">Theatre 118 <span>· Port Dundas</span></p>
      <h2 id="sponsor-title"><a href="${escape(show.url)}" rel="sponsored" ${tracking}>${escape(show.title)}</a></h2>
      <p class="sponsor-facts"><span>${escape(day)}${next.time ? ` · ${escape(clockTime(next.time))}` : ''}</span><span>${escape(formLabel(listing.form))}${show.runtime_minutes ? ` · ${escape(show.runtime_minutes)} minutes` : ''}</span></p>
      <p class="sponsor-description">${escape(description)}</p>
    </div>
    <div class="sponsor-booking"><div><p class="sponsor-price">${escape(price)}</p><p class="sponsor-fee">+ ${escape(money(show.ticketing.booking_fee))} booking fee per order</p><p class="sponsor-pwyc">Pay What You Can available</p></div><a class="btn sponsor-ticket" href="${escape(show.url)}" rel="sponsored" ${tracking} aria-label="Tickets for ${escape(show.title)}">See show &amp; book <span aria-hidden="true">↗</span></a></div>
  </div>
</article>`;
};
