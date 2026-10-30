(() => {
  'use strict';
  const slot = document.getElementById('sponsored-show');
  if (!slot) return;
  const { feed, listing, context } = window.SPONSOR_PREVIEW;
  const wrapper = document.querySelector('.detail-sponsor');
  const { selectSponsoredShow, matchesSponsor } = window.SponsoredShow;
  const candidate = selectSponsoredShow(feed);
  function syncSponsor() {
    const filters = context === 'detail' ? {} : {
      query: document.getElementById('filter-search')?.value,
      venue: document.getElementById('filter-venue')?.value,
      from: document.getElementById('filter-date-from')?.value,
      to: document.getElementById('filter-date-to')?.value,
      form: document.querySelector('.filter-pill.active')?.dataset.form || '',
    };
    slot.hidden = !matchesSponsor(candidate, listing, filters, window.Listings.filterEvents);
    if (wrapper) wrapper.hidden = slot.hidden;
  }
  // These bubble after the unchanged site's filter handlers have updated the
  // active pill and URL. Clearing filters and the next-seven-days shortcut count too.
  document.addEventListener('input', syncSponsor);
  document.addEventListener('change', syncSponsor);
  document.addEventListener('click', event => {
    if (event.target.closest('.filter-pill, [data-reset], #this-week')) syncSponsor();
  });
  setInterval(syncSponsor, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSponsor(); });
  syncSponsor();
})();
