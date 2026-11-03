(() => {
  'use strict';
  const slot = document.getElementById('show-placement');
  if (!slot || !window.SponsoredShow || !window.Listings || !window.ShowCard) return;
  const core = window.SponsoredShow;
  const placement = slot.dataset.placement;
  const recommendationList = document.getElementById('recommendation-list');
  const recommendationData = document.getElementById('recommendation-data');
  const recommendations = recommendationData ? JSON.parse(recommendationData.textContent) : [];
  const canonical = url => (url || '').replace(/\/$/, '');
  let payload = null;
  let expiry;
  let loading = false;
  const rendered = new WeakMap();
  function filters() {
    return placement === 'home' ? {
      query: document.getElementById('filter-search')?.value || '',
      venue: document.getElementById('filter-venue')?.value || '',
      from: document.getElementById('filter-date-from')?.value || '',
      to: document.getElementById('filter-date-to')?.value || '',
      form: document.querySelector('.filter-pill.active')?.dataset.form || '',
    } : {};
  }
  function setContent(container, html) {
    if (rendered.get(container) === html) return;
    const active = container.contains(document.activeElement) ? document.activeElement : null;
    const href = active?.getAttribute('href');
    const label = active?.textContent;
    container.innerHTML = html;
    rendered.set(container, html);
    container.querySelectorAll('img').forEach(image => {
      const repair = () => { image.hidden = true; image.closest('.event-card-image').classList.add('image-unavailable'); };
      image.addEventListener('error', repair, { once: true });
      if (image.complete && !image.naturalWidth) repair();
    });
    if (href) [...container.querySelectorAll('a')].find(link => link.getAttribute('href') === href && link.textContent === label)?.focus({ preventScroll: true });
  }
  function render() {
    const today = core.londonClock().date;
    const active = filters();
    let listing = payload?.sponsor;
    if (!listing || payload.expiresAt <= Date.now() || (payload.endsOn && today > payload.endsOn) || canonical(slot.dataset.currentShowUrl) === canonical(listing.ticketUrl)) listing = null;
    if (listing && !window.Listings.filterEvents([listing], active).length) listing = null;
    const performances = listing ? core.availablePerformances({ ticketing: { on_sale: true }, performances: listing.performances }) : [];
    const html = listing ? core.renderSponsor({ ...listing, performances }, placement, active) : '';
    slot.hidden = !html;
    setContent(slot, html);
    if (!html) listing = null;

    if (placement === 'home') {
      // Keep the original listing available when sponsorship is paused or
      // filtered out. The paid position never duplicates a show or its count.
      const matches = window.Listings.filterEvents(window.EVENTS, active);
      const eligible = new Set(matches.map(event => event.id));
      document.querySelectorAll('#events-grid > .event-card').forEach(card => {
        const duplicate = listing && (card.dataset.id === listing.id || canonical(card.querySelector('.ticket-link')?.getAttribute('href')) === canonical(listing.ticketUrl));
        card.hidden = !eligible.has(card.dataset.id) || Boolean(duplicate);
      });
      const additional = listing && !matches.some(event => event.id === listing.id || canonical(event.ticketUrl) === canonical(listing.ticketUrl));
      const total = matches.length + (additional ? 1 : 0);
      document.getElementById('results-count').textContent = `${total} show${total === 1 ? '' : 's'}`;
      document.getElementById('no-results').hidden = total > 0;
    } else if (recommendationList) {
      const seen = new Set([canonical(slot.dataset.currentShowUrl), ...(listing ? [canonical(listing.ticketUrl)] : [])]);
      const organic = recommendations.filter(show => {
        const url = canonical(show.ticketUrl);
        if ((show.endDate || show.date) < today || seen.has(url) || (listing && show.id === listing.id)) return false;
        seen.add(url);
        return true;
      }).slice(0, listing ? 2 : 3);
      setContent(recommendationList, organic.map(show => window.ShowCard.renderCard(show, { recommendation: true, reason: show.reason })).join(''));
      document.getElementById('you-may-also-like').hidden = !listing && !organic.length;
    }
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const response = await fetch(`/sponsorship?placement=${placement}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Unavailable');
      payload = await response.json();
      clearTimeout(expiry);
      if (payload.expiresAt) expiry = setTimeout(() => { payload = null; render(); refresh(); }, Math.max(0, payload.expiresAt - Date.now()));
    } catch { payload = null; }
    finally { loading = false; render(); }
  }
  document.addEventListener('input', render);
  document.addEventListener('change', render);
  document.addEventListener('click', event => { if (event.target.closest('.filter-pill,[data-reset],#this-week')) render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); refresh(); } });
  setInterval(() => { render(); refresh(); }, 60_000);
  render();
  refresh();
})();
