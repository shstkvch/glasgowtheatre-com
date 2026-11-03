(() => {
  'use strict';
  const slot = document.getElementById('sponsored-show');
  const recommendations = [...document.querySelectorAll('.recommended-show')];
  if (!slot && !recommendations.length) return;
  const { feed, listing, context } = window.SPONSOR_PREVIEW;
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
    if (slot) slot.hidden = !matchesSponsor(candidate, listing, filters, window.Listings.filterEvents);
    if (context === 'detail') {
      const upcoming = new Set(window.Listings.filterEvents(window.EVENTS).map(event => event.id));
      let remaining = slot && !slot.hidden ? 2 : 3;
      for (const card of recommendations) {
        card.hidden = !upcoming.has(card.dataset.id) || remaining <= 0;
        if (!card.hidden) remaining--;
      }
    }
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
