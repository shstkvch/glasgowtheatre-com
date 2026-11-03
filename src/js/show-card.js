/* Shared by the static build and live sponsored/recommendation cards. */
(function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  function renderCard(show, { eager = false, sponsored = false, recommendation = false, surface = 'card', reason = '' } = {}) {
    const track = ` data-track-show="${escape(show.id)}" data-track-venue="${escape(show.venueId)}" data-track-title="${escape(show.title)}" data-track-surface="${escape(surface)}"`;
    const detail = show.detailUrl || show.ticketUrl;
    const outboundDetail = !show.detailUrl;
    const paid = sponsored ? ' rel="sponsored"' : '';
    const detailAttrs = outboundDetail ? paid + track : '';
    const titleId = sponsored ? ' id="sponsor-title"' : '';
    return `<article class="event-card${sponsored ? ' sponsored-show' : ''}${recommendation ? ' recommended-show' : ''}"${!sponsored && !recommendation ? ` id="${escape(show.id)}"` : ''} data-id="${escape(show.id)}" data-date="${escape(show.date)}" data-end-date="${escape(show.endDate || show.date)}"${sponsored ? ' aria-labelledby="sponsor-title"' : ''}>
<div class="event-card-image${show.image ? '' : ' image-unavailable'}${show.artworkWhole ? ' artwork-whole' : ''}"><a class="event-card-thumb" href="${escape(detail)}"${detailAttrs} tabindex="-1"><div class="image-fallback" aria-hidden="true"><span>ON STAGE AT</span><strong>${escape(show.venue)}</strong></div>${show.image ? `<img src="${escape(show.image)}" alt="${escape(show.imageAlt || show.title)}" width="${escape(show.imageWidth || 1100)}" height="${escape(show.imageHeight || 688)}" style="object-position: ${escape(show.imagePosition || '50% 50%')}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">` : ''}</a><span class="date-stamp">${escape(show.dateLabel)}</span></div>
<div class="event-card-body"><div class="card-topline">${sponsored ? `<div class="sponsor-venue"><a href="/venues/${escape(show.venueId)}.html">${escape(show.venue)}</a><span class="sponsor-label">Sponsored</span></div>` : `<a href="/venues/${escape(show.venueId)}.html">${escape(show.season || show.venue)}</a>`}<span>${escape(show.formLabel)}</span></div>
<h3${titleId}><a href="${escape(detail)}"${detailAttrs}>${escape(show.title)}</a></h3>
<p class="card-when">${show.timesLabel ? `<span class="fact-time">${escape(show.timesLabel)}</span>` : ''}${show.priceLabel ? `<span class="fact-price">${escape(show.priceLabel)}</span>` : '<span class="fact-unknown">Prices at the venue</span>'}</p>
<p class="event-description">${escape(show.description)}</p>
${show.accessibility ? `<p class="accessibility"><span aria-hidden="true">✳</span> ${escape(show.accessibility)}</p>` : ''}${reason ? `<p class="recommendation-reason">${escape(reason)}</p>` : ''}
<div class="event-card-footer"><a class="detail-link" href="${escape(detail)}"${detailAttrs}>Prices &amp; times</a><a class="ticket-link${sponsored ? ' sponsor-ticket' : ''}" href="${escape(show.ticketUrl)}"${paid}${track} aria-label="Tickets for ${escape(show.title)}">Tickets <span aria-hidden="true">↗</span></a></div></div></article>`;
  }
  const api = { renderCard };
  if (typeof module !== 'undefined') module.exports = api;
  else root.ShowCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
