(function () {
  'use strict';

  var events = window.EVENTS || [];
  var grid = document.getElementById('events-grid');
  var venueFilter = document.getElementById('filter-venue');
  var dateFromFilter = document.getElementById('filter-date-from');
  var dateToFilter = document.getElementById('filter-date-to');
  var resetBtn = document.getElementById('filter-reset');
  var resultsCount = document.getElementById('results-count');
  var typePills = document.querySelectorAll('.filter-pill');

  if (!grid || !events.length) return;

  var today = new Date().toISOString().split('T')[0];
  var activeType = '';

  function formatDate(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  function formatTime(timeStr) {
    if (!timeStr) return '';
    var parts = timeStr.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1];
    var suffix = h >= 12 ? 'pm' : 'am';
    var hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return hour + ':' + m + suffix;
  }

  function typeLabel(type) {
    var labels = {
      'professional': 'Professional',
      'grassroots': 'Grassroots',
      'new-writing': 'New Writing',
      'scratch': 'Scratch Night',
      'community': 'Community'
    };
    return labels[type] || type;
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function buildCard(ev) {
    var dateText = formatDate(ev.date);
    if (ev.endDate && ev.endDate !== ev.date) {
      dateText += ' \u2013 ' + formatDate(ev.endDate);
    }
    if (ev.time) {
      dateText += ', ' + formatTime(ev.time);
    }

    var imageHtml = ev.image
      ? '<div class="event-card-image"><img src="' + escapeHTML(ev.image) + '" alt="' + escapeHTML(ev.title) + '" loading="lazy"><span class="event-type-badge badge-' + ev.type + '">' + typeLabel(ev.type) + '</span></div>'
      : '<div class="event-card-image event-card-placeholder"><span class="placeholder-star">&#9733;</span><span class="placeholder-venue">' + escapeHTML(ev.venue) + '</span><span class="event-type-badge badge-' + ev.type + '">' + typeLabel(ev.type) + '</span></div>';

    return '<article class="event-card" data-venue="' + ev.venueId + '" data-type="' + ev.type + '" data-date="' + ev.date + '">' +
      imageHtml +
      '<div class="event-card-body">' +
        '<h3 class="event-card-title">' + (ev.ticketUrl ? '<a href="' + escapeHTML(ev.ticketUrl) + '" target="_blank" rel="noopener">' + escapeHTML(ev.title) + '</a>' : escapeHTML(ev.title)) + '</h3>' +
        '<div class="event-meta">' +
          '<span class="event-venue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="meta-icon"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' + escapeHTML(ev.venue) + '</span>' +
          '<span class="event-date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="meta-icon"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' + dateText + '</span>' +
        '</div>' +
        '<p class="event-description">' + escapeHTML(ev.description) + '</p>' +
        '<div class="event-card-footer">' +
          (ev.ticketUrl ? '<a href="' + escapeHTML(ev.ticketUrl) + '" target="_blank" rel="noopener" class="ticket-link">Tickets <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></a>' : '') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderEvents(filtered) {
    if (filtered.length === 0) {
      grid.innerHTML = '<div class="no-results"><p>No events match your filters. Try adjusting your search.</p></div>';
    } else {
      grid.innerHTML = filtered.map(buildCard).join('');
    }
    if (resultsCount) {
      resultsCount.textContent = filtered.length + ' event' + (filtered.length !== 1 ? 's' : '');
    }
  }

  function applyFilters() {
    var venue = venueFilter ? venueFilter.value : '';
    var dateFrom = dateFromFilter ? dateFromFilter.value : '';
    var dateTo = dateToFilter ? dateToFilter.value : '';

    var filtered = events.filter(function (ev) {
      var endDate = ev.endDate || ev.date;
      if (endDate < today) return false;
      if (venue && ev.venueId !== venue) return false;
      if (activeType && ev.type !== activeType) return false;
      if (dateFrom && ev.date < dateFrom) return false;
      if (dateTo && ev.date > dateTo) return false;
      return true;
    });

    renderEvents(filtered);
  }

  // Type pill click handlers
  typePills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      typePills.forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      activeType = pill.getAttribute('data-type') || '';
      applyFilters();
    });
  });

  if (venueFilter) venueFilter.addEventListener('change', applyFilters);
  if (dateFromFilter) dateFromFilter.addEventListener('change', applyFilters);
  if (dateToFilter) dateToFilter.addEventListener('change', applyFilters);

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (venueFilter) venueFilter.value = '';
      if (dateFromFilter) dateFromFilter.value = '';
      if (dateToFilter) dateToFilter.value = '';
      activeType = '';
      typePills.forEach(function (p) { p.classList.remove('active'); });
      var allPill = document.querySelector('.filter-pill[data-type=""]');
      if (allPill) allPill.classList.add('active');
      applyFilters();
    });
  }

  // Initial render (hides past events)
  applyFilters();
})();
