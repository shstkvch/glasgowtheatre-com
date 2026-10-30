const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { selectSponsoredShow } = require('./sponsor-core');
const renderSponsor = require('./render-sponsor.cjs');
const { formLabel: label } = require('../../scripts/art-forms');
const { filterEvents, countArtForms } = require('../../src/js/listings');

const root = path.resolve(__dirname, '../..');
const feed = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshot.json'), 'utf8'));
const selected = selectSponsoredShow(feed);
if (!selected) throw new Error('The saved feed has no upcoming bookable show. Refresh snapshot.json.');
const $ = cheerio.load(fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8'));
const dataScript = $('script').filter((i, el) => $(el).html().trim().startsWith('window.EVENTS ='));
const events = JSON.parse(dataScript.html().trim().replace(/^window\.EVENTS\s*=\s*/, '').replace(/;$/, ''));
// The checked-in homepage may predate a classification correction. Reuse its
// markup, but read categories from the current source data for this preview.
const classified = new Map(['events.json', 'manual-events.json'].flatMap(file =>
  JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8'))).map(event => [event.ticketUrl, event]));
for (const event of events) {
  const source = classified.get(event.ticketUrl);
  if (source) { event.form = source.form; event.tags = source.tags; }
}
$('.event-card').each((i, card) => {
  const event = events.find(event => event.id === $(card).attr('data-id'));
  if (event) $(card).find('.card-topline > span').text(label(event.form));
});
const upcoming = filterEvents(events);
const counts = countArtForms(upcoming);
const pills = $('.filter-pills-group').empty();
pills.append(`<button class="filter-pill active" data-form="" aria-pressed="true">All shows <span class="filter-pill-count">${upcoming.length}</span></button>`);
for (const [form, count] of Object.entries(counts)) {
  pills.append($('<button class="filter-pill" aria-pressed="false">').attr('data-form', form).text(label(form) + ' ').append($('<span class="filter-pill-count">').text(count)));
}
const show = selected.show;
const listing = events.find(event => event.ticketUrl?.replace(/\/$/, '') === show.url.replace(/\/$/, ''));
if (!listing) throw new Error('Match the API show to a Glasgow Theatre listing before previewing its art-form filters.');
// Keep the site's own ID and art form, while using current API editorial data.
Object.assign(listing, { title: show.title, description: show.description, date: show.start_date, endDate: show.end_date });
dataScript.text(`window.EVENTS = ${JSON.stringify(events).replace(/</g, '\\u003c')};`);
const organic = $('.event-card').filter((i, el) => $(el).attr('data-id') === listing.id);
organic.find('h3 a').text(show.title);
organic.find('.event-description').text(show.description);
organic.find('img').attr('src', '/assets/working-it-out.webp');

function preparePreview(doc, title, context) {
  doc('title').text(title + ' | Glasgow Theatre preview');
  doc('head').append('<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/sponsored.css">');
  doc('script[src*="track.js"],script[type="application/ld+json"],link[rel="canonical"]').remove();
  doc('a[href^="/"]').each((i, element) => {
    const href = doc(element).attr('href');
    // Homepage and show details now form one navigable local mockup.
    if (href === '/' || /^\/shows\/[a-z0-9-]+\.html$/.test(href)) return;
    doc(element).attr('href', `https://glasgowtheatre.com${href}`);
  });
  // Bring older checked-in markup up to the existing production tracking
  // attributes, so the local preview can demonstrate organic vs paid clicks.
  const eventScript = doc('script').filter((i, element) => doc(element).html().trim().startsWith('window.EVENTS ='));
  const pageEvents = JSON.parse(eventScript.html().trim().replace(/^window\.EVENTS\s*=\s*/, '').replace(/;$/, ''));
  const trackLink = (link, event, surface) => link.attr({
    'data-track-show': event.id, 'data-track-venue': event.venueId,
    'data-track-title': event.title, 'data-track-surface': surface,
  });
  doc('.event-card').each((i, card) => {
    const event = pageEvents.find(event => event.id === doc(card).attr('data-id'));
    if (event) trackLink(doc(card).find('.ticket-link'), event, 'card');
  });
  if (doc('.show-hero').length) {
    trackLink(doc('.show-hero .btn'), pageEvents[0], 'show-hero');
    trackLink(doc('.ticket-panel .btn'), pageEvents[0], 'show-panel');
  }
  doc('.footer-bottom').append('<span class="preview-note">Sponsored Show design preview · API snapshot 30 October 2026</span>');
  if (context) {
    const config = JSON.stringify({ feed, listing, context }).replace(/</g, '\\u003c');
    doc('body').append(`<script>window.SPONSOR_PREVIEW = ${config};</script><script defer src="/sponsor-core.js"></script><script defer src="/sponsored.js"></script>`);
  }
  // The preview server accepts these beacons locally in memory; it never
  // forwards requests to Cloudflare or the production analytics endpoint.
  doc('body').append('<script defer src="/js/track.js"></script>');
}

const sponsor = renderSponsor(selected, listing, 'sponsored-home');
$('.results-bar').after(sponsor);
preparePreview($, 'Sponsored Show — homepage', 'home');
fs.writeFileSync(path.join(__dirname, 'index.html'), $.html());
console.log(`Preview prepared: ${show.title} / ${selected.performances[0].date} ${selected.performances[0].time}`);

function renderShowPreview(html) {
  const doc = cheerio.load(html);
  const script = doc('script').filter((i, element) => doc(element).html().trim().startsWith('window.EVENTS ='));
  const pageEvents = JSON.parse(script.html().trim().replace(/^window\.EVENTS\s*=\s*/, '').replace(/;$/, ''));
  const current = pageEvents[0];
  const source = classified.get(current.ticketUrl);
  if (source) {
    current.form = source.form;
    current.tags = source.tags;
    const eyebrow = doc('.show-hero-text .eyebrow');
    const venueLink = eyebrow.find('a').clone();
    eyebrow.empty().append(venueLink).append(' · ' + label(source.form));
    doc('.show-facts dt').filter((i, element) => doc(element).text() === 'Art form').next('dd').text(label(source.form));
  }
  const isSponsoredShow = current.ticketUrl.replace(/\/$/, '') === show.url.replace(/\/$/, '');
  if (isSponsoredShow) {
    current.title = show.title;
    current.description = show.description;
    doc('.show-hero h1').text(show.title);
    doc('.show-description').text(show.description);
  } else {
    // Outside both detail columns: always below the description, performance
    // table, prices and concessions, and before the site footer.
    doc('#main').append(`<div class="container detail-sponsor" hidden>${renderSponsor(selected, listing, 'sponsored-detail')}</div>`);
  }
  script.text(`window.EVENTS = ${JSON.stringify(pageEvents).replace(/</g, '\\u003c')};`);
  preparePreview(doc, current.title, isSponsoredShow ? null : 'detail');
  return doc.html();
}

module.exports = { renderShowPreview };
