(function () {
  'use strict';

  var events = window.EVENTS || [];
  var grid = document.getElementById('events-grid');
  var venueFilter = document.getElementById('filter-venue');
  var typeFilter = document.getElementById('filter-type');
  var dateFromFilter = document.getElementById('filter-date-from');
  var dateToFilter = document.getElementById('filter-date-to');
  var resetBtn = document.getElementById('filter-reset');
  var resultsCount = document.getElementById('results-count');

  if (!grid || !events.length) return;

  var today = new Date().toISOString().split('T')[0];

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
      'scratch': 'Scratch',
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

    return '<article class="event-card" data-venue="' + ev.venueId + '" data-type="' + ev.type + '" data-date="' + ev.date + '">' +
      '<div class="event-card-header">' +
        '<h3>' + (ev.ticketUrl ? '<a href="' + escapeHTML(ev.ticketUrl) + '" target="_blank" rel="noopener">' + escapeHTML(ev.title) + '</a>' : escapeHTML(ev.title)) + '</h3>' +
        '<span class="event-type-badge badge-' + ev.type + '">' + typeLabel(ev.type) + '</span>' +
      '</div>' +
      '<div class="event-meta">' +
        '<span class="event-venue">' + escapeHTML(ev.venue) + '</span>' +
        '<span class="event-date">' + dateText + '</span>' +
      '</div>' +
      '<p class="event-description">' + escapeHTML(ev.description) + '</p>' +
      '<div class="event-card-footer">' +
        (ev.ticketUrl ? '<a href="' + escapeHTML(ev.ticketUrl) + '" target="_blank" rel="noopener" class="ticket-link">Tickets <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></a>' : '') +
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
    var type = typeFilter ? typeFilter.value : '';
    var dateFrom = dateFromFilter ? dateFromFilter.value : '';
    var dateTo = dateToFilter ? dateToFilter.value : '';

    var filtered = events.filter(function (ev) {
      var endDate = ev.endDate || ev.date;
      // Hide past events
      if (endDate < today) return false;
      if (venue && ev.venueId !== venue) return false;
      if (type && ev.type !== type) return false;
      if (dateFrom && ev.date < dateFrom) return false;
      if (dateTo && ev.date > dateTo) return false;
      return true;
    });

    renderEvents(filtered);
  }

  if (venueFilter) venueFilter.addEventListener('change', applyFilters);
  if (typeFilter) typeFilter.addEventListener('change', applyFilters);
  if (dateFromFilter) dateFromFilter.addEventListener('change', applyFilters);
  if (dateToFilter) dateToFilter.addEventListener('change', applyFilters);

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (venueFilter) venueFilter.value = '';
      if (typeFilter) typeFilter.value = '';
      if (dateFromFilter) dateFromFilter.value = '';
      if (dateToFilter) dateToFilter.value = '';
      applyFilters();
    });
  }

  // Initial render (hides past events)
  applyFilters();
})();
