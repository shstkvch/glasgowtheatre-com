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

  function selectRandomSponsoredShow(feed, now = new Date(), random) {
    const today = londonClock(now).date;
    // Compare calendar days, so the window stays correct across clock changes.
    const day = date => Date.parse(date + 'T00:00:00Z') / 86400000;
    const candidates = (feed.shows || []).map(show => ({ show, performances: availablePerformances(show, now) }))
      .filter(candidate => candidate.performances.length && Number.isFinite(day(candidate.performances[0].date)))
      .sort((a, b) => String(a.show.id).localeCompare(String(b.show.id)));
    if (!candidates.length) return null;
    const earliest = Math.min(...candidates.map(candidate => day(candidate.performances[0].date) - day(today)));
    let windowDays = 30;
    while (earliest > windowDays) windowDays *= 2;
    const pool = candidates.filter(candidate => day(candidate.performances[0].date) - day(today) <= windowDays);
    // A daily seeded draw keeps the admin preview and public placements aligned
    // without storing a separate pick. Each eligible show gets one entry.
    if (!random) {
      let seed = 2166136261;
      for (const char of today) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
      seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
      seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
      const draw = ((seed ^ (seed >>> 15)) >>> 0) / 4294967296;
      random = () => draw;
    }
    return { ...pool[Math.floor(random() * pool.length)], windowDays };
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

  const DEFAULTS = { enabled: true, startsOn: '', endsOn: '', home: true, detail: true, mode: 'next', showSlug: '', description: '', revision: 0 };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const safeUrl = value => { try { const url = new URL(value); return url.origin === 'https://theatre118.com' && !url.username && !url.password ? url.href : null; } catch { return null; } };
  const validDate = value => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(value + 'T12:00:00Z'); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; };
  function validateSettings(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['Send sponsorship settings as an object.'] };
    for (const field of ['enabled', 'home', 'detail']) if (typeof input[field] !== 'boolean') errors.push(`${field} must be true or false.`);
    for (const field of ['startsOn', 'endsOn']) if (typeof input[field] !== 'string' || (input[field] && !validDate(input[field]))) errors.push(`${field} must be a valid date.`);
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) errors.push('End date must be on or after the start date.');
    if (input.enabled && !input.home && !input.detail) errors.push('Choose at least one placement.');
    if (!['next', 'random', 'specific'].includes(input.mode)) errors.push('Choose next available, random or a specific show.');
    if (typeof input.showSlug !== 'string' || (input.mode === 'specific' && !/^[a-z0-9][a-z0-9-]{0,159}$/.test(input.showSlug))) errors.push('Choose a show.');
    if (typeof input.description !== 'string' || input.description.trim().length > 280) errors.push('Promotional description must be 280 characters or fewer.');
    if (!Number.isInteger(input.revision) || input.revision < 0) errors.push('Reload these settings before saving.');
    if (errors.length) return { errors };
    return { errors, value: { enabled: input.enabled, home: input.home, detail: input.detail, startsOn: input.startsOn, endsOn: input.endsOn, mode: input.mode, showSlug: input.mode === 'specific' ? input.showSlug : '', description: input.description.trim(), revision: input.revision } };
  }
  function isActive(settings, placement, now = new Date()) {
    const today = londonClock(now).date;
    return settings.enabled && Boolean(settings[placement]) && (!settings.startsOn || today >= settings.startsOn) && (!settings.endsOn || today <= settings.endsOn);
  }
  function choose(feed, settings, now = new Date(), random) {
    if (settings.mode === 'random') return selectRandomSponsoredShow(feed, now, random);
    return selectSponsoredShow(settings.mode === 'specific' ? { shows: (feed.shows || []).filter(show => show.slug === settings.showSlug) } : feed, now);
  }
  function normalise(candidate, metadata = {}, settings = DEFAULTS) {
    const show = candidate.show;
    const url = safeUrl(show.url);
    if (!url || typeof show.title !== 'string' || !show.title.trim()) return null;
    const meta = metadata[url.replace(/\/$/, '')] || {};
    const text = `${show.title} ${show.description || ''}`;
    const form = meta.form || (/scratch[ -]night|new[ -]material[ -]night/i.test(text) ? 'scratch' : /panto/i.test(text) ? 'pantomime' : 'play');
    const fixed = (show.ticketing.ticket_types || []).filter(ticket => ticket.kind === 'fixed' && Number.isInteger(ticket.price) && ticket.price >= 0).map(ticket => ticket.price);
    const image = safeUrl(show.image?.url);
    const imagePath = image && new URL(image).pathname;
    return {
      id: meta.id || `theatre-118-${String(show.id).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`,
      title: show.title, venue: 'Theatre 118', venueId: 'theatre-118', area: 'Port Dundas',
      date: show.start_date || candidate.performances[0].date, endDate: show.end_date || show.start_date || candidate.performances.at(-1).date,
      form, formLabel: meta.formLabel || (form === 'scratch' ? 'Scratch / new material' : form.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')),
      tags: meta.tags || [form], description: show.description || '',
      promotionalDescription: settings.description || (show.description || '').slice(0, 220),
      ticketUrl: url, performances: candidate.performances,
      image: imagePath && /^\/(storage|images)\//.test(imagePath) ? `/sponsor-image?path=${encodeURIComponent(imagePath)}` : null,
      runtime: Number.isInteger(show.runtime_minutes) && show.runtime_minutes > 0 ? show.runtime_minutes : null,
      price: fixed.length ? Math.min(...fixed) : null,
      fee: Number.isInteger(show.ticketing.booking_fee) && show.ticketing.booking_fee >= 0 ? show.ticketing.booking_fee : null,
      payWhatYouCan: show.ticketing.pay_what_you_can === true,
      minimum: Number.isInteger(show.ticketing.pay_what_you_can_minimum) && show.ticketing.pay_what_you_can_minimum >= 0 ? show.ticketing.pay_what_you_can_minimum : null,
    };
  }
  function money(pence) { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100); }
  function renderSponsor(listing, placement, filters = {}) {
    const performance = listing.performances.find(p => (!filters.from || p.date >= filters.from) && (!filters.to || p.date <= filters.to));
    if (!performance) return '';
    const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(performance.date + 'T12:00:00Z'));
    let time = '';
    if (performance.time) { const [h, m] = performance.time.split(':').map(Number); time = ` · ${h % 12 || 12}${m ? '.' + String(m).padStart(2, '0') : ''}${h >= 12 ? 'pm' : 'am'}`; }
    const track = `data-track-show="${escape(listing.id)}" data-track-venue="theatre-118" data-track-title="${escape(listing.title)}" data-track-surface="sponsored-${placement}"`;
    const price = listing.price != null ? `${money(listing.price)} tickets` : listing.minimum != null ? `Pay What You Can from ${money(listing.minimum)}` : 'Prices at the venue';
    return `<article class="sponsored-show" aria-labelledby="sponsor-title"><div class="sponsor-disclosure"><span class="sponsor-label">Sponsored Show</span><span>Paid placement by Theatre 118</span></div><div class="sponsor-layout"><a class="sponsor-art" href="${escape(listing.ticketUrl)}" rel="sponsored" ${track} tabindex="-1" aria-hidden="true">${listing.image ? `<img src="${escape(listing.image)}" alt="" width="764" height="510" loading="lazy">` : '<span class="sponsor-image-fallback">THEATRE<br>118</span>'}</a><div class="sponsor-copy"><p class="sponsor-venue">Theatre 118 <span>· Port Dundas</span></p><h2 id="sponsor-title"><a href="${escape(listing.ticketUrl)}" rel="sponsored" ${track}>${escape(listing.title)}</a></h2><p class="sponsor-facts"><span>${escape(day + time)}</span><span>${escape(listing.formLabel)}${listing.runtime ? ` · ${listing.runtime} minutes` : ''}</span></p><p class="sponsor-description">${escape(listing.promotionalDescription)}</p></div><div class="sponsor-booking"><div><p class="sponsor-price">${escape(price)}</p>${listing.fee != null ? `<p class="sponsor-fee">+ ${escape(money(listing.fee))} booking fee per order</p>` : ''}${listing.payWhatYouCan ? `<p class="sponsor-pwyc">Pay What You Can${listing.minimum != null ? ' from ' + escape(money(listing.minimum)) : ' available'}</p>` : ''}</div><a class="btn sponsor-ticket" href="${escape(listing.ticketUrl)}" rel="sponsored" ${track} aria-label="Tickets for ${escape(listing.title)}">See show &amp; book <span aria-hidden="true">↗</span></a></div></div></article>`;
  }
  const api = { londonClock, availablePerformances, selectSponsoredShow, selectRandomSponsoredShow, matchesSponsor, DEFAULTS, safeUrl, validateSettings, isActive, choose, normalise, renderSponsor };
  if (typeof module !== 'undefined') module.exports = api;
  else root.SponsoredShow = api;
})(typeof window !== 'undefined' ? window : globalThis);
