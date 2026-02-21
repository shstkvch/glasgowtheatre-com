const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const DATA = path.join(__dirname, 'data');
const SRC = path.join(__dirname, 'src');
const SITE_URL = 'https://glasgowtheatre.com';
const BUILD_TIME = new Date();
const BUILD_TIMESTAMP = BUILD_TIME.toISOString();
const BUILD_DATE_HUMAN = BUILD_TIME.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// --- Helpers ---

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf-8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

function formatDateRange(event) {
  let text = formatDate(event.date);
  if (event.endDate && event.endDate !== event.date) {
    text += ` &ndash; ${formatDate(event.endDate)}`;
  }
  if (event.time) {
    text += `, ${formatTime(event.time)}`;
  }
  return text;
}

function typeLabel(type) {
  const labels = {
    'professional': 'Professional',
    'grassroots': 'Grassroots',
    'new-writing': 'New Writing',
    'scratch': 'Scratch Night',
    'community': 'Community'
  };
  return labels[type] || type;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncateDescription(str, maxLen) {
  if (str.length <= maxLen) return str;
  var truncated = str.substring(0, maxLen);
  var lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLen - 30) truncated = truncated.substring(0, lastSpace);
  return truncated.replace(/[.,;:!?\s]+$/, '') + '...';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function getUpcomingEvents(events) {
  const today = new Date().toISOString().split('T')[0];
  return events.filter(e => {
    const end = e.endDate || e.date;
    return end >= today;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function getThisWeekEvents(events) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];
  return events.filter(e => {
    const end = e.endDate || e.date;
    return end >= todayStr && e.date <= nextWeekStr;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function getUniqueVenueCount(events) {
  return new Set(events.map(e => e.venueId)).size;
}

// --- HTML Fragments ---

const analytics = `<!-- Umami Analytics -->\n<script defer src="https://cloud.umami.is/script.js" data-website-id="UMAMI_WEBSITE_ID"></script>`;

function htmlHead({ title, description, canonicalPath, ogType = 'website', cssPath = 'css/style.css' }) {
  const canonical = `${SITE_URL}${canonicalPath}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<meta name="description" content="${escapeHTML(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escapeHTML(title)}">
<meta property="og:description" content="${escapeHTML(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Glasgow Theatre">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHTML(title)}">
<meta name="twitter:description" content="${escapeHTML(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;0,800;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${cssPath}">
${analytics}
</head>`;
}

function header(activePage, pathPrefix = '') {
  const nav = (page, label) => {
    const active = activePage === page ? ' class="active"' : '';
    const href = page === 'events' ? `${pathPrefix}/` : `${pathPrefix}/${page}.html`;
    return `<a href="${href}"${active}>${label}</a>`;
  };
  return `<header class="site-header">
  <div class="container header-inner">
    <div class="site-brand">
      <a href="${pathPrefix}/">
        <div class="site-title">Glasgow <span>Theatre</span></div>
      </a>
    </div>
    <nav class="main-nav" aria-label="Main navigation">
      ${nav('events', 'What\'s On')}
      ${nav('venues', 'Venues')}
      ${nav('submit', 'List Your Show')}
      ${nav('about', 'About')}
    </nav>
  </div>
</header>`;
}

function footer(venues, pathPrefix = '') {
  const venueLinks = venues.map(v =>
    `<li><a href="${pathPrefix}/venues/${v.id}.html">${escapeHTML(v.name)}</a></li>`
  ).join('\n          ');

  return `<footer class="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-about">
        <div class="footer-brand">Glasgow <span>Theatre</span></div>
        <p>Your independent guide to Glasgow's theatre scene &mdash; from the big stages to the grassroots fringe.</p>
      </div>
      <div class="footer-links">
        <h4>Venues</h4>
        <ul>
          ${venueLinks}
        </ul>
      </div>
      <div class="footer-links">
        <h4>Pages</h4>
        <ul>
          <li><a href="${pathPrefix}/">What's On</a></li>
          <li><a href="${pathPrefix}/venues.html">All Venues</a></li>
          <li><a href="${pathPrefix}/submit.html">List Your Show</a></li>
          <li><a href="${pathPrefix}/about.html">About</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>&copy; ${new Date().getFullYear()} glasgowtheatre.com</span>
      <span class="footer-updated">Last updated ${BUILD_DATE_HUMAN}</span>
    </div>
  </div>
</footer>`;
}

// --- Cards ---

function eventCard(event, cssPath) {
  const titleHtml = event.ticketUrl
    ? `<a href="${escapeHTML(event.ticketUrl)}" target="_blank" rel="noopener">${escapeHTML(event.title)}</a>`
    : escapeHTML(event.title);

  const ticketHtml = event.ticketUrl
    ? `<a href="${escapeHTML(event.ticketUrl)}" class="ticket-link" target="_blank" rel="noopener">Tickets <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></a>`
    : '';

  return `<article class="event-card" data-venue="${escapeHTML(event.venueId)}" data-type="${escapeHTML(event.type)}" data-date="${escapeHTML(event.date)}">
  <div class="event-card-header">
    <span class="event-type-badge badge-${event.type}">${typeLabel(event.type)}</span>
  </div>
  <h3 class="event-card-title">${titleHtml}</h3>
  <div class="event-meta">
    <span class="event-venue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="meta-icon"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHTML(event.venue)}</span>
    <span class="event-date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="meta-icon"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${formatDateRange(event)}</span>
  </div>
  <p class="event-description">${escapeHTML(event.description)}</p>
  <div class="event-card-footer">${ticketHtml}</div>
</article>`;
}

function venueCardIndex(venue) {
  return `<a href="/venues/${venue.id}.html" class="venue-card venue-card-link">
  <h3>${escapeHTML(venue.name)}</h3>
  <div class="venue-area">${escapeHTML(venue.area)}</div>
  <p class="venue-description">${escapeHTML(venue.description)}</p>
  <span class="venue-card-arrow">View venue &rarr;</span>
</a>`;
}

// --- JSON-LD ---

function eventJsonLd(event) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TheaterEvent',
    name: event.title,
    description: event.description,
    startDate: event.time ? `${event.date}T${event.time}:00` : event.date,
    location: {
      '@type': 'PerformingArtsTheater',
      name: event.venue,
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Glasgow',
        addressCountry: 'GB'
      }
    },
    performer: {
      '@type': 'PerformingGroup',
      name: event.venue
    }
  };
  if (event.endDate) {
    ld.endDate = event.time ? `${event.endDate}T${event.time}:00` : event.endDate;
  }
  if (event.ticketUrl) {
    ld.offers = {
      '@type': 'Offer',
      url: event.ticketUrl,
      availability: 'https://schema.org/InStock'
    };
  }
  return ld;
}

function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Glasgow Theatre',
    url: SITE_URL,
    description: "Your independent guide to Glasgow's theatre scene"
  };
}

// --- Build Pages ---

function buildEventsPage(events, venues) {
  console.log('Building index.html (events)...');

  const upcoming = getUpcomingEvents(events);
  const thisWeek = getThisWeekEvents(events);
  const venueCount = getUniqueVenueCount(upcoming);

  const venueOptions = [...new Map(events.map(e => [e.venueId, e.venue])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${escapeHTML(id)}">${escapeHTML(name)}</option>`)
    .join('\n              ');

  const types = ['professional', 'grassroots', 'new-writing', 'scratch', 'community'];
  const typePills = types.map(t =>
    `<button class="filter-pill" data-type="${t}">${typeLabel(t)}</button>`
  ).join('\n            ');

  const thisWeekCards = thisWeek.map(e => eventCard(e)).join('\n    ');
  const allCards = upcoming.map(e => eventCard(e)).join('\n    ');

  const allEventsLd = upcoming.map(e => eventJsonLd(e));
  const jsonLdScript = `<script type="application/ld+json">${JSON.stringify(websiteJsonLd())}</script>
<script type="application/ld+json">${JSON.stringify(allEventsLd)}</script>`;

  const thisWeekSection = thisWeek.length > 0 ? `
  <section class="this-week-section">
    <div class="container">
      <div class="section-header">
        <h2>This Week</h2>
        <span class="section-count">${thisWeek.length} show${thisWeek.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="events-grid">
    ${thisWeekCards}
      </div>
    </div>
  </section>` : '';

  const html = `${htmlHead({
    title: "Glasgow Theatre \u2014 What's On This Week | glasgowtheatre.com",
    description: "Discover theatre in Glasgow. Professional productions, new writing, scratch nights, and grassroots events across the city's best venues. Updated weekly.",
    canonicalPath: '/'
  })}
<body>
${header('events')}
<main>
  <section class="hero">
    <div class="hero-bg"></div>
    <div class="container hero-content">
      <h1>Glasgow <em>Theatre</em></h1>
      <p class="hero-tagline">Your independent guide to what's on across the city's stages</p>
      <div class="hero-stats">
        <span class="hero-stat"><strong>${upcoming.length}</strong> shows coming up across <strong>${venueCount}</strong> venues</span>
      </div>
    </div>
  </section>
${thisWeekSection}

  <section class="filter-bar" id="all-events">
    <div class="container">
      <div class="section-header">
        <h2>All Upcoming Events</h2>
        <span class="results-count" id="results-count">${upcoming.length} events</span>
      </div>
      <div class="filter-controls">
        <div class="filter-pills-group">
          <button class="filter-pill active" data-type="">All</button>
            ${typePills}
        </div>
        <div class="filter-row">
          <div class="filter-group">
            <label for="filter-venue">Venue</label>
            <select id="filter-venue">
              <option value="">All Venues</option>
              ${venueOptions}
            </select>
          </div>
          <div class="filter-group">
            <label for="filter-date-from">From</label>
            <input type="date" id="filter-date-from">
          </div>
          <div class="filter-group">
            <label for="filter-date-to">To</label>
            <input type="date" id="filter-date-to">
          </div>
          <button class="filter-reset" id="filter-reset" type="button">Reset Filters</button>
        </div>
      </div>
    </div>
  </section>

  <section class="events-section">
    <div class="container">
      <div class="events-grid" id="events-grid">
    ${allCards}
      </div>
      <div class="no-results" id="no-results" style="display:none">
        <p>No events match your filters.</p>
      </div>
    </div>
  </section>

  <section class="updated-section">
    <div class="container">
      <p class="last-updated">Last updated: ${BUILD_DATE_HUMAN}</p>
    </div>
  </section>
</main>
${footer(venues)}
${jsonLdScript}
<script>window.EVENTS = ${JSON.stringify(upcoming)};</script>
<script src="js/main.js"></script>
</body>
</html>`;

  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  console.log('  -> dist/index.html');
}

function buildVenuesPage(venues, events) {
  console.log('Building venues.html...');

  const venueCards = venues.map(v => venueCardIndex(v)).join('\n    ');

  const html = `${htmlHead({
    title: "Glasgow Theatre Venues \u2014 A Guide to the City's Stages",
    description: "Explore Glasgow's theatre venues \u2014 from the Citizens and Tron to grassroots spaces like The Old Hairdressers and Mono. Find what's on at each venue.",
    canonicalPath: '/venues.html'
  })}
<body>
${header('venues')}
<main>
  <section class="page-hero">
    <div class="container">
      <h1>Venues</h1>
      <p class="page-intro">Glasgow's theatre scene spans grand Victorian stages, converted churches, and artist-run DIY spaces. Here's where to find them.</p>
    </div>
  </section>

  <section class="venues-section">
    <div class="container">
      <div class="venues-grid">
    ${venueCards}
      </div>
    </div>
  </section>
</main>
${footer(venues)}
</body>
</html>`;

  fs.writeFileSync(path.join(DIST, 'venues.html'), html);
  console.log('  -> dist/venues.html');
}

function buildVenuePage(venue, events, venues) {
  const venueEvents = getUpcomingEvents(events.filter(e => e.venueId === venue.id));
  const eventCards = venueEvents.map(e => eventCard(e, '../css/style.css')).join('\n    ');

  const eventsSection = venueEvents.length > 0 ? `
  <section class="venue-events-section">
    <div class="container">
      <h2>Upcoming at ${escapeHTML(venue.name)}</h2>
      <div class="events-grid">
    ${eventCards}
      </div>
    </div>
  </section>` : `
  <section class="venue-events-section">
    <div class="container">
      <h2>Upcoming at ${escapeHTML(venue.name)}</h2>
      <p class="no-events-message">No upcoming events listed yet. <a href="/submit.html">Submit a listing</a> if you know of one.</p>
    </div>
  </section>`;

  const venueJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'PerformingArtsTheater',
    name: venue.name,
    description: venue.description,
    url: venue.website,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Glasgow',
      addressRegion: venue.area,
      addressCountry: 'GB'
    }
  };

  const html = `${htmlHead({
    title: `${venue.name} \u2014 What's On | Glasgow Theatre`,
    description: truncateDescription(venue.description, 155),
    canonicalPath: `/venues/${venue.id}.html`,
    cssPath: '../css/style.css'
  })}
<body>
${header('venues', '..')}
<main>
  <section class="venue-hero">
    <div class="container">
      <div class="venue-hero-content">
        <span class="venue-area-tag">${escapeHTML(venue.area)}</span>
        <h1>${escapeHTML(venue.name)}</h1>
        <p class="venue-hero-description">${escapeHTML(venue.description)}</p>
        <div class="venue-hero-links">
          <a href="${escapeHTML(venue.website)}" target="_blank" rel="noopener" class="btn btn-primary">Visit Website <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></a>
          ${venue.instagram ? `<a href="https://instagram.com/${escapeHTML(venue.instagram)}" target="_blank" rel="noopener" class="btn btn-secondary">Instagram</a>` : ''}
        </div>
      </div>
    </div>
  </section>
${eventsSection}
</main>
${footer(venues, '..')}
<script type="application/ld+json">${JSON.stringify(venueJsonLd)}</script>
</body>
</html>`;

  ensureDir(path.join(DIST, 'venues'));
  fs.writeFileSync(path.join(DIST, 'venues', `${venue.id}.html`), html);
}

function buildVenuePages(venues, events) {
  console.log('Building individual venue pages...');
  for (const venue of venues) {
    buildVenuePage(venue, events, venues);
  }
  console.log(`  -> dist/venues/ (${venues.length} pages)`);
}

function buildAboutPage(venues) {
  console.log('Building about.html...');

  const html = `${htmlHead({
    title: "About Glasgow Theatre \u2014 An Independent Theatre Guide",
    description: "glasgowtheatre.com is an independent resource for Glasgow's theatre scene. We list what's on across the city \u2014 professional, grassroots, and everything in between.",
    canonicalPath: '/about.html'
  })}
<body>
${header('about')}
<main>
  <section class="page-hero">
    <div class="container">
      <h1>About</h1>
    </div>
  </section>

  <section class="about-section">
    <div class="container">
      <div class="about-content">
        <p class="about-lead">glasgowtheatre.com is an independent guide to what's on across Glasgow's stages. We believe every show matters &mdash; from the main stage at the Citizens to a scratch night in a basement on Renfield Lane.</p>

        <h2>Why we exist</h2>
        <p>Glasgow has one of the most vibrant and diverse theatre ecosystems in the UK. Scotland's flagship producing theatres sit alongside fiercely independent artist-run spaces, lunchtime theatre in converted churches, and community festivals that pop up in parks and shopfronts. But finding out what's actually on &mdash; across all of it &mdash; isn't always easy.</p>
        <p>That's what this site is for. One place to see what's happening, from professional productions to grassroots new writing to experimental scratch nights. No paywalls, no algorithms, no corporate sponsorship. Just a clear, honest listing of what's on.</p>

        <h2>Who runs this</h2>
        <p>This is an independent project, made by people who love Glasgow theatre. We're not affiliated with any venue or production company. We update the site regularly and aim to cover as much of the city's theatre scene as we can.</p>

        <h2>How to get in touch</h2>
        <div class="contact-block">
          <p>Want to list a show, suggest a venue, flag an error, or just say hello? We'd love to hear from you.</p>
          <p><a href="mailto:info@glasgowtheatre.com" class="contact-email">info@glasgowtheatre.com</a></p>
        </div>

        <h2>Listings are free</h2>
        <p>We don't charge to list events. If you're putting on a show in Glasgow, <a href="/submit.html">send us the details</a> and we'll add it to the site.</p>
      </div>
    </div>
  </section>
</main>
${footer(venues)}
</body>
</html>`;

  fs.writeFileSync(path.join(DIST, 'about.html'), html);
  console.log('  -> dist/about.html');
}

function buildSubmitPage(venues) {
  console.log('Building submit.html...');

  const html = `${htmlHead({
    title: "List Your Show \u2014 Glasgow Theatre",
    description: "Submit your theatre event to glasgowtheatre.com for free. We list professional productions, new writing, scratch nights, and community events across Glasgow.",
    canonicalPath: '/submit.html'
  })}
<body>
${header('submit')}
<main>
  <section class="page-hero">
    <div class="container">
      <h1>List Your Show</h1>
      <p class="page-intro">Got a show coming up in Glasgow? We'd love to list it. It's free, always.</p>
    </div>
  </section>

  <section class="submit-section">
    <div class="container">
      <div class="submit-content">
        <div class="submit-info">
          <h2>How it works</h2>
          <p>Email us the details of your show and we'll add it to the site. We list everything &mdash; professional productions, new writing, scratch nights, community events, experimental work, lunchtime shows. If it's theatre and it's in Glasgow, it belongs here.</p>

          <h2>What to include</h2>
          <ul class="submit-checklist">
            <li>Show name</li>
            <li>Venue</li>
            <li>Date(s) and time(s)</li>
            <li>A short description (2-3 sentences is perfect)</li>
            <li>Ticket link or booking info</li>
            <li>Type of show (professional, grassroots, new writing, scratch night, community)</li>
          </ul>

          <p>Don't worry about getting everything perfect &mdash; send us what you have and we'll sort the rest.</p>

          <div class="submit-cta">
            <h2>Send your listing to</h2>
            <a href="mailto:info@glasgowtheatre.com?subject=Show%20Listing" class="contact-email-large">info@glasgowtheatre.com</a>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>
${footer(venues)}
</body>
</html>`;

  fs.writeFileSync(path.join(DIST, 'submit.html'), html);
  console.log('  -> dist/submit.html');
}

function buildSitemap(venues) {
  console.log('Building sitemap.xml...');
  const today = BUILD_TIME.toISOString().split('T')[0];

  const pages = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/venues.html', priority: '0.8', changefreq: 'weekly' },
    { loc: '/about.html', priority: '0.5', changefreq: 'monthly' },
    { loc: '/submit.html', priority: '0.5', changefreq: 'monthly' },
  ];

  for (const venue of venues) {
    pages.push({ loc: `/venues/${venue.id}.html`, priority: '0.7', changefreq: 'weekly' });
  }

  const urls = pages.map(p => `  <url>
    <loc>${SITE_URL}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), xml);
  console.log('  -> dist/sitemap.xml');
}

function buildRobotsTxt() {
  console.log('Building robots.txt...');
  const txt = `User-agent: *
Allow: /
Sitemap: ${SITE_URL}/sitemap.xml
`;
  fs.writeFileSync(path.join(DIST, 'robots.txt'), txt);
  console.log('  -> dist/robots.txt');
}

// --- Main ---

console.log('Glasgow Theatre \u2014 Build');
console.log('=======================\n');
console.log(`Build time: ${BUILD_TIMESTAMP}\n`);

const events = readJSON('events.json');
const venues = readJSON('venues.json');
console.log(`Loaded ${events.length} events, ${venues.length} venues.\n`);

ensureDir(DIST);

console.log('Copying static assets...');
copyDir(path.join(SRC, 'css'), path.join(DIST, 'css'));
copyDir(path.join(SRC, 'js'), path.join(DIST, 'js'));
console.log('  -> dist/css/, dist/js/\n');

buildEventsPage(events, venues);
buildVenuesPage(venues, events);
buildVenuePages(venues, events);
buildAboutPage(venues);
buildSubmitPage(venues);
buildSitemap(venues);
buildRobotsTxt();

// Build summary
const upcoming = getUpcomingEvents(events);
const thisWeek = getThisWeekEvents(events);
console.log('\n=======================');
console.log('Build Summary');
console.log('=======================');
console.log(`Pages built: ${4 + venues.length} (index + venues index + ${venues.length} venue pages + about + submit)`);
console.log(`Events: ${events.length} total, ${upcoming.length} upcoming, ${thisWeek.length} this week`);
console.log(`Venues: ${venues.length}`);
console.log(`Sitemap: ${4 + venues.length} URLs`);
console.log(`Build time: ${BUILD_TIMESTAMP}`);
console.log('\nBuild complete.');
