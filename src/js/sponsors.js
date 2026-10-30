(() => {
  'use strict';
  const slot = document.getElementById('sponsored-slot');
  if (!slot || !window.SponsoredShow || !window.Listings) return;
  const core = window.SponsoredShow;
  const placement = slot.dataset.placement;
  let payload = null;
  let expiry;
  let loading = false;
  let rendered = '';
  function filters() {
    return placement === 'home' ? {
      query: document.getElementById('filter-search')?.value || '',
      venue: document.getElementById('filter-venue')?.value || '',
      from: document.getElementById('filter-date-from')?.value || '',
      to: document.getElementById('filter-date-to')?.value || '',
      form: document.querySelector('.filter-pill.active')?.dataset.form || '',
    } : {};
  }
  function hide() { slot.hidden = true; slot.replaceChildren(); rendered = ''; }
  function render() {
    const listing = payload?.sponsor;
    const today = core.londonClock().date;
    if (!listing || payload.expiresAt <= Date.now() || (payload.endsOn && today > payload.endsOn) || slot.dataset.currentShowUrl?.replace(/\/$/, '') === listing.ticketUrl.replace(/\/$/, '')) return hide();
    const active = filters();
    if (!window.Listings.filterEvents([listing], active).length) return hide();
    const performances = core.availablePerformances({ ticketing: { on_sale: true }, performances: listing.performances });
    const html = core.renderSponsor({ ...listing, performances }, placement, active);
    if (!html) return hide();
    // Every interpolated field is escaped by the shared renderer. Links and
    // image URLs have already been restricted by the server-side normaliser.
    const focused = [...slot.querySelectorAll('a')].indexOf(document.activeElement);
    if (rendered !== html) {
      slot.innerHTML = html;
      rendered = html;
      slot.querySelector('img')?.addEventListener('error', event => {
        event.target.hidden = true;
        slot.querySelector('.sponsor-art').classList.add('sponsor-image-missing');
      }, { once: true });
      if (focused >= 0) slot.querySelectorAll('a')[focused]?.focus({ preventScroll: true });
    }
    slot.hidden = false;
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const response = await fetch(`/sponsorship?placement=${placement}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Unavailable');
      payload = await response.json();
      clearTimeout(expiry);
      if (payload.expiresAt) expiry = setTimeout(() => { hide(); refresh(); }, Math.max(0, payload.expiresAt - Date.now()));
      render();
    } catch { payload = null; hide(); }
    finally { loading = false; }
  }
  document.addEventListener('input', render);
  document.addEventListener('change', render);
  document.addEventListener('click', event => { if (event.target.closest('.filter-pill,[data-reset],#this-week')) render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); refresh(); } });
  setInterval(() => { render(); refresh(); }, 60_000);
  refresh();
})();
