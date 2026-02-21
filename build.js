const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const DATA = path.join(__dirname, 'data');
const SRC = path.join(__dirname, 'src');

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
    'scratch': 'Scratch',
    'community': 'Community'
  };
  return labels[type] || type;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- HTML Fragments ---

const analytics = `<!-- Umami Analytics -->\n<script defer src="https://cloud.umami.is/script.js" data-website-id="UMAMI_WEBSITE_ID"></script>`;

function htmlHead(title, description) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<meta name="description" content="${escapeHTML(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
${analytics}
</head>`;
}

function header(activePage) {
  const nav = (page, label) => {
    const active = activePage === page ? ' class="active"' : '';
    const href = page === 'events' ? '/' : `/${page}.html`;
    return `<a href="${href}"${active}>${label}</a>`;
  };
  return `<header class="site-header">
  <div class="container header-inner">
    <div class="site-brand">
      <a href="/">
        <div class="site-title">Glasgow <span>Theatre</span></div>
      </a>
      <div class="site-tagline">What's on in Glasgow's theatre scene</div>
    </div>
    <nav class="main-nav" aria-label="Main navigation">
      ${nav('events', 'Events')}
      ${nav('venues', 'Venues')}
      ${nav('about', 'About')}
    </nav>
  </div>
</header>`;
}

function footer(venues) {
  const venueLinks = venues.map(v =>
    `<li><a href="${escapeHTML(v.website)}" target="_blank" rel="noopener">${escapeHTML(v.name)}</a></li>`
  ).join('\n          ');

  return `<footer class="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-about">
        <div class="site-title" style="font-family:'Playfair Display',Georgia,serif;font-size:1.2rem;font-weight:700;">Glasgow <span style="color:#c9a84c;">Theatre</span></div>
        <p>Your guide to Glasgow's theatre scene &mdash; from the big stages to the grassroots fringe.</p>
      </div>
      <div class="footer-links">
        <h4>Key Venues</h4>
        <ul>
          ${venueLinks}
        </ul>
      </div>
    </div>
    <div class="footer-bottom">&copy; ${new Date().getFullYear()} glasgowtheatre.com</div>
  </div>
</footer>`;
}

// --- Cards ---

function eventCard(event) {
  const titleHtml = event.ticketUrl
    ? `<a href="${escapeHTML(event.ticketUrl)}" target="_blank" rel="noopener">${escapeHTML(event.title)}</a>`
    : escapeHTML(event.title);

  const ticketHtml = event.ticketUrl
    ? `<a href="${escapeHTML(event.ticketUrl)}" class="ticket-link" target="_blank" rel="noopener">Tickets <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></a>`
    : '';

  return `<article class="event-card" data-venue="${escapeHTML(event.venueId)}" data-type="${escapeHTML(event.type)}" data-date="${escapeHTML(event.date)}">
  <div class="event-card-header">
    <h3>${titleHtml}</h3>
    <span class="event-type-badge badge-${event.type}">${typeLabel(event.type)}</span>
  </div>
  <div class="event-meta">
    <span class="event-venue">${escapeHTML(event.venue)}</span>
    <span class="event-date">${formatDateRange(event)}</span>
  </div>
  <p class="event-description">${escapeHTML(event.description)}</p>
  <div class="event-card-footer">${ticketHtml}</div>
</article>`;
}

function venueCard(venue) {
  return `<article class="venue-card">
  <h3>${escapeHTML(venue.name)}</h3>
  <div class="venue-area">${escapeHTML(venue.area)}</div>
  <p class="venue-description">${escapeHTML(venue.description)}</p>
  <div class="venue-links">
    <a href="${escapeHTML(venue.website)}" target="_blank" rel="noopener">Website</a>
    ${venue.instagram ? `<a href="https://instagram.com/${escapeHTML(venue.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ''}
  </div>
</article>`;
}

// --- Build Pages ---

function buildEventsPage(events, venues) {
  console.log('Building index.html (events)...');

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

  const venueOptions = [...new Map(events.map(e => [e.venueId, e.venue])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${escapeHTML(id)}">${escapeHTML(name)}</option>`)
    .join('\n              ');

  const typeOptions = ['professional', 'grassroots', 'new-writing', 'scratch', 'community']
    .map(t => `<option value="${t}">${typeLabel(t)}</option>`)
    .join('\n              ');

  const eventCards = sorted.map(e => eventCard(e)).join('\n    ');

  const html = `${htmlHead("Glasgow Theatre — What's On", "Upcoming theatre events in Glasgow. Professional productions, new writing, scratch nights, and community events across Glasgow's best venues.")}
<body>
${header('events')}
<main>
  <section class="hero">
    <div class="container">
      <h1>What's on in Glasgow's <span>theatre</span> scene</h1>
      <p>Professional productions, new writing, scratch nights, and grassroots events across the city's stages.</p>
    </div>
  </section>

  <section class="filter-bar">
    <div class="container">
      <div class="filter-controls">
        <div class="filter-group">
          <label for="filter-venue">Venue</label>
          <select id="filter-venue">
            <option value="all">All Venues</option>
              ${venueOptions}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-type">Type</label>
          <select id="filter-type">
            <option value="all">All Types</option>
              ${typeOptions}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-date">From Date</label>
          <input type="date" id="filter-date">
        </div>
        <button class="filter-reset" type="button">Reset</button>
        <span class="results-count">${sorted.length} events</span>
      </div>
    </div>
  </section>

  <section class="events-section">
    <div class="container">
      <div class="events-grid" id="events-grid">
    ${eventCards}
      </div>
      <div class="no-results" id="no-results" style="display:none">
        <p>No events match your filters.</p>
      </div>
    </div>
  </section>
</main>
${footer(venues)}
<script>window.EVENTS = ${JSON.stringify(sorted)};</script>
<script src="js/main.js"></script>
</body>
</html>`;

  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  console.log('  -> dist/index.html');
}

function buildVenuesPage(venues) {
  console.log('Building venues.html...');

  const venueCards = venues.map(v => venueCard(v)).join('\n    ');

  const html = `${htmlHead('Venues — Glasgow Theatre', "Glasgow's key theatre venues, from the Citizens and Tron to grassroots spaces like The Old Hairdressers and Mono.")}
<body>
${header('venues')}
<main>
  <section class="venues-section">
    <div class="container">
      <h2>Venues</h2>
      <p class="venues-intro">Glasgow's theatre scene spans grand Victorian stages, converted churches, and artist-run DIY spaces.</p>
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

function buildAboutPage(venues) {
  console.log('Building about.html...');

  const html = `${htmlHead('About — Glasgow Theatre', "About glasgowtheatre.com — your guide to what's on in Glasgow's theatre scene.")}
<body>
${header('about')}
<main>
  <section class="about-section">
    <div class="container">
      <div class="about-content">
        <h2>About Glasgow Theatre</h2>
        <p>glasgowtheatre.com is your go-to resource for Glasgow's theatre scene &mdash; professional and grassroots, mainstream and independent.</p>
        <p>We list upcoming events, profile key venues, and surface scratch nights, new writing events, and DIY happenings alongside the big productions. Whether you're looking for a world premiere at the Citizens, a lunchtime show at Oran Mor, or an experimental evening at The Old Hairdressers, we've got you covered.</p>
        <p>Glasgow has one of the most vibrant and diverse theatre ecosystems in the UK. From Scotland's flagship producing theatres to community-led festivals and artist-run spaces, there's always something worth seeing. Every stage matters.</p>

        <div class="contact-block">
          <h3>Get in Touch</h3>
          <p>Want to list an event, suggest a venue, or just say hello?</p>
          <p><a href="mailto:info@glasgowtheatre.com">info@glasgowtheatre.com</a></p>
        </div>
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

// --- Main ---

console.log('Glasgow Theatre — Build');
console.log('=======================\n');

const events = readJSON('events.json');
const venues = readJSON('venues.json');
console.log(`Loaded ${events.length} events, ${venues.length} venues.\n`);

ensureDir(DIST);

console.log('Copying static assets...');
copyDir(path.join(SRC, 'css'), path.join(DIST, 'css'));
copyDir(path.join(SRC, 'js'), path.join(DIST, 'js'));
console.log('  -> dist/css/, dist/js/\n');

buildEventsPage(events, venues);
buildVenuesPage(venues);
buildAboutPage(venues);

console.log('\nBuild complete.');
