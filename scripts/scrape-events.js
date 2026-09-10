#!/usr/bin/env node

/**
 * Glasgow Theatre Event Scraper
 *
 * Scrapes real event data from Glasgow venue websites and populates data/events.json.
 *
 * Sources:
 * 1. Citizens Theatre — https://citz.co.uk/whats-on/
 * 2. Tron Theatre — https://www.tron.co.uk/whats-on/
 * 3. Tramway — https://www.tramway.org/whats-on
 * 4. Oran Mor — https://oran-mor.co.uk/events/
 * 5. The Glad Cafe — https://www.thegladcafe.co.uk/whats-on/
 * 6. Eventbrite Glasgow Theatre — https://www.eventbrite.co.uk/d/united-kingdom--glasgow/theatre/
 *
 * Usage: node scripts/scrape-events.js
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
// ATG publishes almost a year ahead. Listing that far out buries what is on
// this week, so the horizon is capped for every source alike.
const HORIZON_MONTHS = 6;
// Every source that should produce listings, so a silent zero can be spotted.
const ALL_SOURCES = [
  'citizens', 'tron', 'tramway', 'oran-mor', 'glad-cafe',
  'kings', 'theatre-royal', 'pavilion', 'platform', 'cottiers', 'old-hairdressers',
];
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const { londonDate } = require('../src/js/listings');
const TODAY = londonDate();

// Why a source produced nothing, keyed by venueId. Surfaced in
// refresh-status.json so a stale venue explains itself without the build log.
const FAILURES = {};

let fetchFn;
async function getFetch() {
  if (!fetchFn) {
    const mod = await import('node-fetch');
    fetchFn = mod.default;
  }
  return fetchFn;
}

// --- Helpers ---

async function fetchPage(url, retries = 2) {
  const fetch = await getFetch();
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      if (i === retries) throw err;
      await sleep(1000 * (i + 1));
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse date strings in various UK formats into YYYY-MM-DD.
 * Handles: "21 Feb 2026", "21 February 2026", "5th Mar 2026", "2026-03-05", etc.
 */
function parseDate(str) {
  if (!str) return null;
  str = str.trim();

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Remove ordinal suffixes
  str = str.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  const months = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };

  // "21 Feb 2026" or "21 February 2026"
  let m = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m) {
    const mon = months[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[1]).padStart(2, '0')}`;
  }

  // "Feb 21, 2026" or "February 21, 2026"
  m = str.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = months[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[2]).padStart(2, '0')}`;
  }

  // "Fri 24 Apr 2026" format (with weekday prefix)
  m = str.match(/\w+\s+(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m) {
    const mon = months[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[1]).padStart(2, '0')}`;
  }

  // Try native Date parsing as fallback
  const d = new Date(str);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 2025) {
    return d.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse a date range string like "21 – 28 Feb 2026" or "21 Feb – 14 Mar 2026"
 * or "21 Mar–04 Apr 2026" into { startDate, endDate }
 */
function parseDateRange(str) {
  if (!str) return { startDate: null, endDate: null };
  str = str.trim().replace(/\s+/g, ' ');

  // Remove ordinal suffixes
  str = str.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  // Strip weekday names (Monday, Mon, etc.)
  const weekdayRe = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b,?\s*/gi;
  str = str.replace(weekdayRe, '').trim();

  const months = {
    jan: '01', january: '01', feb: '02', february: '02',
    mar: '03', march: '03', apr: '04', april: '04',
    may: '05', jun: '06', june: '06', jul: '07', july: '07',
    aug: '08', august: '08', sep: '09', september: '09',
    oct: '10', october: '10', nov: '11', november: '11',
    dec: '12', december: '12',
  };

  function monthNum(s) {
    return months[s.toLowerCase()] || null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return { startDate: str, endDate: null };

  // "Until Sat 19 Sep" is a run that opened before today and closes on that
  // date. Read literally it would list a show as opening on its closing night.
  const until = str.match(/^(?:until|to)\s+(.+)$/i);
  if (until) {
    const endDate = parseDate(until[1]);
    if (endDate) return { startDate: TODAY, endDate };
  }

  // Split on dash/ndash/emdash
  const parts = str.split(/\s*[–—-]\s*/);

  if (parts.length === 2) {
    const endDate = parseDate(parts[1]);

    // Start part might be "21 Feb 2026" (full) or "21" (day only) or "21 Feb" (day+month)
    const startStr = parts[0].trim();
    let startDate = parseDate(startStr);

    if (!startDate && endDate) {
      // Try "21 Feb" format - borrow year from end date
      let sm = startStr.match(/(\d{1,2})\s+(\w+)/);
      if (sm) {
        const mon = monthNum(sm[2]);
        if (mon) {
          startDate = `${endDate.substring(0, 4)}-${mon}-${String(sm[1]).padStart(2, '0')}`;
        }
      }
      // Try day only - borrow month and year from end date
      if (!startDate) {
        sm = startStr.match(/(\d{1,2})/);
        if (sm) {
          startDate = `${endDate.substring(0, 7)}-${String(sm[1]).padStart(2, '0')}`;
        }
      }
    }

    return { startDate, endDate };
  }

  // Single date
  const single = parseDate(str);
  return { startDate: single, endDate: null };
}

/**
 * Parse time from a string. Returns "HH:MM" in 24h format or null.
 */
function parseTime(str) {
  if (!str) return null;
  str = str.trim().toLowerCase().replace(/(\d)\.(\d{2})/g, '$1:$2');
  const hourOnly = str.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (hourOnly && !str.includes(':')) {
    const h = Number(hourOnly[1]);
    if (h < 1 || h > 12) return null;
    return String(h % 12 + (hourOnly[2] === 'pm' ? 12 : 0)).padStart(2, '0') + ':00';
  }

  // "7:30pm", "19:30", "2:30pm"
  let m = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ampm = m[3];
    if (ampm) {
      if (ampm.toLowerCase() === 'pm' && h < 12) h += 12;
      if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
    }
    return `${String(h).padStart(2, '0')}:${min}`;
  }

  return null;
}

/* --- Prices and performance times ------------------------------------- */

const {
  readPricing,
  headlineTime,
  readDuration,
  mergePricing,
} = require('./tickets');

/** Every date in a run, inclusive of both ends. */
function datesBetween(from, to) {
  const days = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86400000)
    days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

/**
 * A moment as Glasgow experiences it.
 *
 * Half these sources publish performance times in UTC: ATG's structured data
 * says a 7.30pm October curtain is "18:30Z", which is true and useless on a
 * listing. A datetime with no zone is already local and is taken as written.
 */
function londonMoment(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(text);
  const naive = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!zoned) return naive ? { date: naive[1], time: `${naive[2]}:${naive[3]}` } : null;
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

/**
 * Hang a schedule on a listing.
 *
 * The performances are the record — a detail page lists them one by one — and
 * the listing's own `time` becomes whichever curtain the run uses most, so a
 * card showing a single time shows the usual one rather than the first. A run
 * whose opening night is a 2pm preview no longer reads as a matinee season.
 */
function attachSchedule(event, performances, { partial = false } = {}) {
  const clean = (performances || [])
    .filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
    .map((p) => ({
      date: p.date,
      ...(p.time && /^\d{2}:\d{2}$/.test(p.time) ? { time: p.time } : {}),
      ...(p.note ? { note: p.note } : {}),
      ...(p.access && p.access.length ? { access: p.access } : {}),
      ...(p.url ? { url: p.url } : {}),
      ...(p.price != null ? { price: p.price } : {}),
    }))
    .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
  if (!clean.length) return event;
  event.performances = clean;
  if (partial) event.performancesPartial = true;
  event.time = headlineTime(clean) || event.time || null;
  return event;
}

/**
 * The text of an element with its line breaks intact.
 *
 * `.text()` welds a `<br>`-separated price list into "Monday: £17Tuesday-
 * Friday: £19", which reads as one number. Keeping the breaks keeps each
 * price its own line, which is how the venue wrote it and how it is parsed.
 */
function blockText($, selection) {
  const el = selection.first();
  if (!el.length) return '';
  const html = (el.html() || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
  return cheerio
    .load(`<div>${html}</div>`)('div')
    .text()
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join('\n');
}

/**
 * Every schema.org event a page declares.
 *
 * Four of these venues publish their performance times and prices as
 * structured data and nowhere else a scraper can reach: ATG emits one block
 * per performance with the cheapest seat as its offer, Trafalgar one block
 * with an offer per performance, and the Glad and Cottiers one block each.
 * Reading it is both more honest and more robust than reading their layout.
 */
function jsonLdEvents(html) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (/Event$/.test(String(node['@type'] || ''))) found.push(node);
    if (Array.isArray(node['@graph'])) walk(node['@graph']);
  };
  for (const [, body] of String(html).matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(body));
    } catch {
      // A malformed block is one venue's bad day, not a reason to lose the rest.
    }
  }
  return found;
}

/** Offers as a list, however the page chose to write them. */
const offersOf = (event) =>
  [event && event.offers].flat().filter((o) => o && typeof o === 'object');

/** Drop the empty fields rather than publish `"pricing": null` 150 times. */
function attachPricing(event, pricing, extra = {}) {
  const merged = pricing && (pricing.from != null || pricing.text) ? pricing : null;
  if (merged) {
    if (extra.notes) merged.notes = extra.notes;
    event.pricing = merged;
  }
  if (extra.duration) event.duration = extra.duration;
  if (extra.scheduleText) event.scheduleText = extra.scheduleText;
  return event;
}

function cleanText(text) {
  if (!text) return '';
  return (
    text
      // Titles pulled out of an RSC payload still carry JSON escapes, so
      // "Piff \\u0026 Pop" would otherwise reach a card exactly like that.
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function truncateDesc(text, max = 300) {
  if (!text || text.length <= max) return text;
  const truncated = text.substring(0, max);
  const lastSpace = truncated.lastIndexOf(' ');
  return truncated.substring(0, lastSpace > max - 50 ? lastSpace : max).replace(/[.,;:!?\s]+$/, '') + '...';
}

function makeId(venue, title) {
  const slug = `${venue}-${title}`
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 60);
  return slug;
}

function isFutureEvent(event) {
  const end = event.endDate || event.date;
  return end && end >= TODAY;
}

function classifyEventType(title, venue, description) {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes('scratch') || text.includes('works-in-progress') || text.includes('outside eyes')) return 'scratch';
  if (text.includes('community') || text.includes('workshop') || text.includes('young makers') || text.includes('collective')) return 'community';
  if (text.includes('new writing') || text.includes('new play') || text.includes('premiere') || text.includes('a play, a pie')) return 'new-writing';
  if (text.includes('grassroots') || text.includes('open mic') || text.includes('spoken word')) return 'grassroots';
  return 'professional';
}

const { fallbackForm } = require('./art-forms');

function classifyTags(title, description) {
  return [fallbackForm({ title, description })];
}

// --- Scrapers ---

/**
 * The Citz publishes more than anyone else: a price band, a running time, and
 * a schedule listing every performance with its curtain time, its access
 * provision and whatever is happening around it. All of it is read here.
 *
 * The discount copy is picked out of the important-information block by the
 * paragraph that mentions discounts, rather than taking the whole block, which
 * also carries age guidance and content warnings that belong elsewhere.
 */
function citizensTickets($page) {
  const performances = $page('.c-event-instance')
    .toArray()
    .map((el) => {
      const $item = $page(el);
      const date = $item.find('.c-event-instance__date time').attr('datetime');
      return {
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : null,
        time: parseTime($item.find('.c-event-instance__time time').attr('datetime') || ''),
        note: cleanText($item.find('.c-event-instance__note').text()) || null,
        access: cleanText($item.find('.c-event-instance__access-list').text())
          .split(/\s*[,;]\s*|\s{2,}/)
          .map((s) => s.trim())
          .filter(Boolean),
        url: $item.find('.c-event-instance__booking a').attr('href') || null,
      };
    });

  // The Citz's own discount copy is deliberately not scraped: it is the same
  // four passes as data/concessions.json, written as one unpunctuated run
  // with "More about our discounts" welded to the end where the link was.
  // The hand-checked version says it better and says who qualifies.
  const out = {};
  attachSchedule(out, performances);
  attachPricing(out, readPricing(cleanText($page('.c-event__price-label').first().text())), {
    duration: readDuration(cleanText($page('.c-event__duration-label').first().text())),
  });
  return out;
}

async function scrapeCitizens() {
  console.log('\n🎭 Scraping Citizens Theatre...');
  const events = [];

  try {
    const html = await fetchPage('https://citz.co.uk/whats-on/');
    const $ = cheerio.load(html);

    const cards = $('div.c-event-card--shows');
    console.log(`  Found ${cards.length} show cards on listing page`);

    // Filter for theatre productions (exclude comedy tours, workshops, tours, participate)
    const excludePatterns = [
      /heritage.*tour/i, /building tour/i, /young makers/i, /community collective/i,
      /storytime/i, /119 players/i, /up stage/i, /class act/i, /pre-show.*tour/i,
    ];

    for (const card of cards.toArray()) {
      const $card = $(card);
      const title = cleanText($card.find('h3.c-event-card__title').text());
      const url = $card.find('a.c-event-card__permalink').attr('href');
      const dateText = cleanText($card.find('.c-event-card__date-label').text());
      const location = cleanText($card.find('.c-event-card__location-label').text());

      if (!title || !url) continue;
      if (excludePatterns.some((p) => p.test(title))) {
        console.log(`  Skipping (excluded): ${title}`);
        continue;
      }

      // Get image from data-srcset (highest res) or src
      let image = null;
      const $img = $card.find('.c-event-card__fig img');
      const srcset = $img.attr('data-srcset');
      if (srcset) {
        // Get the highest resolution image from srcset
        const srcsetParts = srcset.split(',').map((s) => s.trim());
        const lastPart = srcsetParts[srcsetParts.length - 1];
        if (lastPart) {
          image = lastPart.split(/\s+/)[0];
        }
      }
      if (!image) {
        image = $img.attr('src') || null;
      }
      // Preserve the venue's image URL, including transformation parameters.

      const { startDate, endDate } = parseDateRange(dateText);

      if (!startDate) {
        console.log(`  Skipping (no date): ${title}`);
        continue;
      }

      events.push({
        title,
        url: url.startsWith('http') ? url : `https://citz.co.uk${url}`,
        date: startDate,
        endDate,
        image,
        location,
        description: null, // Will fetch from individual pages
      });
    }

    // Fetch descriptions from individual show pages (limit concurrency)
    console.log(`  Fetching descriptions for ${events.length} shows...`);
    for (let i = 0; i < events.length; i += 3) {
      const batch = events.slice(i, i + 3);
      await Promise.all(
        batch.map(async (event) => {
          try {
            const pageHtml = await fetchPage(event.url);
            const $page = cheerio.load(pageHtml);
            const descEl = $page('.c-event-details__intro.c-wysiwyg').first();
            if (descEl.length) {
              const rawDesc = cleanText(descEl.text());
              event.description = truncateDesc(rawDesc);
            }
            // Also try masthead intro if no description found
            if (!event.description) {
              const masthead = $page('.c-masthead__intro .c-masthead__excerpt').first();
              if (masthead.length) {
                event.description = truncateDesc(cleanText(masthead.text()));
              }
            }
            Object.assign(event, citizensTickets($page));
          } catch (err) {
            console.log(`  Warning: Could not fetch ${event.url}: ${err.message}`);
          }
        })
      );
      if (i + 3 < events.length) await sleep(500);
    }

    // Map to our schema
    const results = events
      .filter(isFutureEvent)
      .map((e) => {
        const type = classifyEventType(e.title, 'Citizens Theatre', e.description || '');
        return {
          id: makeId('citz', e.title),
          title: e.title,
          venue: 'Citizens Theatre',
          venueId: 'citizens',
          date: e.date,
          // Curtain times vary across a run, so the schedule is the record and
          // this is whichever time that run uses most often.
          time: e.time || null,
          endDate: e.endDate,
          type,
          tags: classifyTags(e.title, e.description || '', type),
          description: e.description || `${e.title} at Citizens Theatre, Glasgow.`,
          ticketUrl: e.url,
          image: e.image,
          ...(e.performances ? { performances: e.performances } : {}),
          ...(e.pricing ? { pricing: e.pricing } : {}),
          ...(e.duration ? { duration: e.duration } : {}),
        };
      });

    console.log(`  ✓ ${results.length} events from Citizens Theatre`);
    return results;
  } catch (err) {
    console.error(`  ✗ Citizens Theatre scrape failed: ${err.message}`);
    FAILURES['citizens'] = err.message;
    return [];
  }
}

/**
 * Tron prices come from Spektrix, not from the website.
 *
 * The Tron's own show pages have a prices column in the performance table and
 * it is commented out in the markup, left reading "From £0.00". The box office
 * behind it publishes the real thing — "Previews: £16 | Main Run: £19, £23 or
 * £26" — through the open web API every Spektrix client exposes, along with
 * the running time. One request covers the whole programme.
 *
 * It fails open, like everything else here: no API, no prices, and the rest of
 * the listing is unaffected.
 */
async function spektrixEvents(client) {
  try {
    const events = JSON.parse(await fetchPage(`https://system.spektrix.com/${client}/api/v3/events`));
    if (!Array.isArray(events)) throw new Error('not a list of events');
    return new Map(events.map((e) => [cleanText(e.name).toLowerCase(), e]));
  } catch (err) {
    console.log(`  Warning: no Spektrix prices for ${client}: ${err.message}`);
    return new Map();
  }
}

/** Every performance the Tron lists, with the label it puts on the night. */
function tronPerformances($page) {
  return $page('#performances tr')
    .toArray()
    .map((row) => {
      const $row = $page(row);
      const { startDate } = parseDateRange(cleanText($row.find('.cell_date').first().text()));
      return {
        date: startDate,
        time: parseTime(cleanText($row.find('.cell_time').first().text())),
        note: cleanText($row.find('.cell_details .instance_message').first().text()) || null,
        url: $row.find('.cell_button a').attr('href') || null,
      };
    });
}

async function scrapeTron() {
  console.log('\n🎭 Scraping Tron Theatre...');
  const events = [];
  const prices = await spektrixEvents('tron');

  try {
    const html = await fetchPage('https://www.tron.co.uk/whats-on/');
    const $ = cheerio.load(html);

    // Title links and image divs are separate elements. Collect them independently
    // and match by index (they appear in the same order in the DOM).
    const titleLinks = $('.event_title a');
    const imageDivs = $('div.event-image.loop-image');
    canary('tron', `no .event_title links (${pageShape(html)})`, titleLinks.length > 0);
    console.log(`  Found ${titleLinks.length} shows on listing page`);

    const showUrls = [];
    titleLinks.each((i, el) => {
      const $a = $(el);
      const title = cleanText($a.text());
      const url = $a.attr('href');
      if (!title || !url) return;

      // Get image from the corresponding image div by index
      let image = null;
      if (i < imageDivs.length) {
        const style = $(imageDivs[i]).attr('style') || '';
        const bgMatch = style.match(/background-image:\s*url\(([^)]+)\)/);
        if (bgMatch) {
          image = bgMatch[1].replace(/['"]/g, '');
          if (!image.startsWith('http')) image = `https://www.tron.co.uk${image}`;
          // Remove thumbnail size suffix to get full resolution
          image = image.replace(/-\d+x\d+(\.\w+)$/, '$1');
        }
      }

      const fullUrl = url.startsWith('http') ? url : `https://www.tron.co.uk${url}`;
      showUrls.push({ title, url: fullUrl, image });
    });

    // Fetch individual show pages for dates, descriptions, and better images
    console.log(`  Fetching details for ${showUrls.length} shows...`);
    for (let i = 0; i < showUrls.length; i += 2) {
      const batch = showUrls.slice(i, i + 2);
      await Promise.all(
        batch.map(async (show) => {
          try {
            const pageHtml = await fetchPage(show.url);
            const $page = cheerio.load(pageHtml);

            // Get description from OG meta (most reliable for Tron)
            let description = '';
            const ogDesc = $page('meta[property="og:description"]').attr('content');
            if (ogDesc) description = truncateDesc(cleanText(ogDesc));

            // Fallback: get from page paragraphs
            if (!description) {
              const paragraphs = $page('main p, article p');
              const descParts = [];
              paragraphs.each((_, el) => {
                const text = cleanText($page(el).text());
                if (text.length > 40 && !text.match(/^(ticket|price|book|£|cast:|written by|directed by|set |sound |lighting )/i)) {
                  descParts.push(text);
                }
              });
              if (descParts.length) description = truncateDesc(descParts.slice(0, 2).join(' '));
            }

            // Get image from OG meta if we don't have one
            if (!show.image) {
              const ogImage = $page('meta[property="og:image"]').attr('content');
              if (ogImage) {
                show.image = ogImage.startsWith('http') ? ogImage : `https://www.tron.co.uk${ogImage}`;
              }
            }

            // Get dates from page - look for "Day DD Month YYYY" pattern
            const dateTexts = [];
            const pageText = $page('body').text();
            const dateMatches = pageText.match(
              /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/gi
            );
            if (dateMatches) {
              for (const dm of dateMatches) {
                // Strip weekday prefix
                const cleaned = dm.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+/i, '');
                const parsed = parseDate(cleaned);
                if (parsed) dateTexts.push(parsed);
              }
            }

            let firstDate = null;
            let lastDate = null;
            if (dateTexts.length > 0) {
              dateTexts.sort();
              firstDate = dateTexts[0];
              lastDate = dateTexts.length > 1 ? dateTexts[dateTexts.length - 1] : null;
              if (lastDate === firstDate) lastDate = null;
            }

            // Get time
            let time = null;
            const timeMatch = pageText.match(/(\d{1,2}[:.]\d{2})\s*(am|pm)/i);
            if (timeMatch) time = parseTime(timeMatch[0]);

            if (firstDate) {
              const listing = {
                title: show.title,
                url: show.url,
                date: firstDate,
                endDate: lastDate,
                time: time || null,
                image: show.image,
                description: description || `${show.title} at Tron Theatre, Glasgow.`,
              };
              attachSchedule(listing, tronPerformances($page));
              const sold = prices.get(show.title.toLowerCase());
              attachPricing(listing, readPricing(sold?.attribute_Prices), {
                notes: cleanText(sold?.attribute_TicketInformation || '') || null,
                duration: readDuration(sold?.duration),
              });
              events.push(listing);
            } else {
              console.log(`  Warning: No dates found for "${show.title}"`);
            }
          } catch (err) {
            console.log(`  Warning: Could not fetch ${show.url}: ${err.message}`);
          }
        })
      );
      if (i + 2 < showUrls.length) await sleep(500);
    }

    const results = events
      .filter(isFutureEvent)
      .map((e) => {
        const type = classifyEventType(e.title, 'Tron Theatre', e.description);
        return {
          id: makeId('tron', e.title),
          title: e.title,
          venue: 'Tron Theatre',
          venueId: 'tron',
          date: e.date,
          time: e.time,
          endDate: e.endDate,
          type,
          tags: classifyTags(e.title, e.description, type),
          description: e.description,
          ticketUrl: e.url,
          image: e.image,
          ...(e.performances ? { performances: e.performances } : {}),
          ...(e.pricing ? { pricing: e.pricing } : {}),
          ...(e.duration ? { duration: e.duration } : {}),
        };
      });

    console.log(`  ✓ ${results.length} events from Tron Theatre`);
    return results;
  } catch (err) {
    console.error(`  ✗ Tron Theatre scrape failed: ${err.message}`);
    FAILURES['tron'] = err.message;
    return [];
  }
}

async function scrapeTramway() {
  console.log('\n🎭 Scraping Tramway...');
  const events = [];

  try {
    const html = await fetchPage('https://www.tramway.org/whats-on');
    const $ = cheerio.load(html);

    const cards = $('a.card');
    console.log(`  Found ${cards.length} event cards on listing page`);

    // Performance-related categories to include
    const performanceCategories = ['performance', 'dance', 'comedy', 'music', 'theatre', 'festival'];

    for (const card of cards.toArray()) {
      const $card = $(card);
      const title = cleanText($card.find('.card__title').text());
      const category = cleanText($card.find('.card__category').text()).toLowerCase();
      const dateText = cleanText($card.find('.card__date').text());
      const image = $card.find('.card__img').attr('src') || null;
      const href = $card.attr('href');

      if (!title) continue;

      // Filter for performance-related events
      const isPerformance = performanceCategories.some((cat) => category.includes(cat));
      if (!isPerformance) {
        console.log(`  Skipping (not performance): ${title} [${category}]`);
        continue;
      }

      // Parse date range
      const { startDate, endDate } = parseDateRange(dateText);
      if (!startDate) {
        console.log(`  Skipping (no date): ${title}`);
        continue;
      }

      const url = href
        ? href.startsWith('http')
          ? href
          : `https://www.tramway.org${href}`
        : null;

      events.push({
        title,
        url,
        date: startDate,
        endDate,
        image,
        category,
        description: null,
      });
    }

    // Fetch descriptions from individual pages
    console.log(`  Fetching descriptions for ${events.length} events...`);
    for (let i = 0; i < events.length; i += 3) {
      const batch = events.slice(i, i + 3);
      await Promise.all(
        batch.map(async (event) => {
          if (!event.url) return;
          try {
            const pageHtml = await fetchPage(event.url);
            const $page = cheerio.load(pageHtml);

            // Glasgow Life prints one line each for the date, the time and the
            // price: "7.30pm - 9.00pm" and "£20/£12", the second figure being
            // the concession. A Tramway listing is a single performance, so
            // that time and the listing's date are the whole schedule.
            const timeText = cleanText($page('.event-details__time').first().text());
            event.time = parseTime(timeText);
            event.scheduleText = timeText || null;
            attachPricing(
              event,
              readPricing(cleanText($page('.event-details__price').first().text())),
              { notes: cleanText($page('.event-details__category').first().text()) || null },
            );
            if (event.time && !event.endDate)
              attachSchedule(event, [{ date: event.date, time: event.time }]);
            const descEl = $page('main p').filter((_, el) => cleanText($page(el).text()).length > 60).first();
            if (descEl.length) {
              event.description = truncateDesc(cleanText(descEl.text()));
            }
            if (!event.description) {
              const metaDesc = $page('meta[name="description"]').attr('content');
              if (metaDesc) event.description = truncateDesc(cleanText(metaDesc));
            }
            if (!event.description) {
              // Gather paragraphs
              const parts = [];
              $page('main p, .content p, article p').each((_, el) => {
                const text = cleanText($page(el).text());
                if (text.length > 30 && !text.match(/^(ticket|price|book|£)/i)) {
                  parts.push(text);
                }
              });
              if (parts.length) {
                event.description = truncateDesc(parts.slice(0, 3).join(' '));
              }
            }
          } catch (err) {
            console.log(`  Warning: Could not fetch ${event.url}: ${err.message}`);
          }
        })
      );
      if (i + 3 < events.length) await sleep(500);
    }

    const results = events
      .filter(isFutureEvent)
      .map((e) => {
        const type = classifyEventType(e.title, 'Tramway', e.description || '');
        return {
          id: makeId('tramway', e.title),
          title: e.title,
          venue: 'Tramway',
          venueId: 'tramway',
          date: e.date,
          time: e.time || null,
          endDate: e.endDate,
          type,
          tags: classifyTags(e.title, e.description || '', type),
          description: e.description || `${e.title} at Tramway, Glasgow.`,
          ticketUrl: e.url,
          image: e.image,
          ...(e.performances ? { performances: e.performances } : {}),
          ...(e.pricing ? { pricing: e.pricing } : {}),
          ...(e.scheduleText ? { scheduleText: e.scheduleText } : {}),
        };
      });

    console.log(`  ✓ ${results.length} events from Tramway`);
    return results;
  } catch (err) {
    console.error(`  ✗ Tramway scrape failed: ${err.message}`);
    FAILURES['tramway'] = err.message;
    return [];
  }
}

async function scrapePlayPiePint() {
  console.log('\n🎭 Scraping A Play, A Pie and A Pint (Oran Mor)...');
  // PPAP has its own dedicated website at playpiepint.com
  const events = [];

  try {
    const html = await fetchPage('https://playpiepint.com/plays/');
    const $ = cheerio.load(html);

    // Get all show links from the listing page
    const showLinks = $('a[href*="/whats-on/event/"]');
    console.log(`  Found ${showLinks.length} shows on PPAP listing`);

    const shows = [];
    const seen = new Set();
    showLinks.each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href || seen.has(href)) return;
      seen.add(href);

      const title = cleanText($a.find('h3, h2, strong').first().text());
      let image = $a.find('img').first().attr('src') || null;
      if (image) {
        // Remove thumbnail params and size suffix
        image = image.split('?')[0].replace(/-\d+x\d+(\.\w+)$/, '$1');
      }

      if (title) {
        if (!/community tour/i.test(title)) shows.push({ title, url: href, image });
      }
    });

    console.log(`  ${shows.length} unique shows to fetch`);

    // Fetch individual show pages for dates, descriptions
    for (let i = 0; i < shows.length; i += 3) {
      const batch = shows.slice(i, i + 3);
      await Promise.all(
        batch.map(async (show) => {
          try {
            const pageHtml = await fetchPage(show.url);
            const $page = cheerio.load(pageHtml);

            // Get description from OG meta
            const ogDesc = $page('meta[property="og:description"]').attr('content');
            let description = ogDesc ? truncateDesc(cleanText(ogDesc)) : '';

            // Fallback: first meaningful paragraph
            if (!description) {
              $page('main p, article p, .entry-content p').each((_, el) => {
                if (description) return;
                const text = cleanText($page(el).text());
                if (text.length > 40 && !text.match(/^(monday|ticket|price|£|cast|written|directed|transaction)/i)) {
                  description = truncateDesc(text);
                }
              });
            }

            // Get image from OG meta (full resolution)
            const ogImage = $page('meta[property="og:image"]').attr('content');
            if (ogImage && !show.image) {
              show.image = ogImage;
            }
            // Prefer OG image as it's usually higher quality
            if (ogImage) show.image = ogImage;

            // Get dates from .event-date element
            const eventDateText = cleanText($page('.event-date').first().text());
            const { startDate, endDate } = parseDateRange(eventDateText);

            if (startDate) {
              // A Play, A Pie and A Pint prices by the day of the week and
              // says so in prose — "Monday: £17 / Tuesday-Friday: £19 /
              // Saturday: £22.50" — with the pie and the drink in the price.
              const times = blockText($page, $page('.opening-times')) || null;
              const priceText = blockText($page, $page('.prices'));
              const listing = {
                title: show.title,
                url: show.url,
                date: startDate,
                endDate,
                time: parseTime($page('.opening-times').first().text().split('(')[0]),
                image: show.image,
                description: description || `A Play, A Pie and A Pint: ${show.title} at Oran Mor, Glasgow.`,
                scheduleText: times,
              };
              attachPricing(listing, readPricing(priceText), {
                notes: blockText($page, $page('.general-ticket-info')) || null,
              });
              events.push(listing);
            } else {
              console.log(`  Warning: No dates for "${show.title}" (text: "${eventDateText}")`);
            }
          } catch (err) {
            console.log(`  Warning: Could not fetch ${show.url}: ${err.message}`);
          }
        })
      );
      if (i + 3 < shows.length) await sleep(500);
    }

    const results = events
      .filter(isFutureEvent)
      .map((e) => ({
        id: makeId('oran-mor', e.title),
        title: e.title,
        venue: 'Òran Mór',
        venueId: 'oran-mor',
        // The audience knows this season by name, not by the building it runs in.
        season: 'A Play, A Pie and A Pint',
        date: e.date,
        time: e.time || null,
        endDate: e.endDate,
        type: 'new-writing',
        tags: ['play', ...(e.time === '13:00' ? ['lunchtime'] : ['scratch']), 'a-play-a-pie-a-pint'],
        description: e.description,
        ticketUrl: e.url,
        image: e.image,
        ...(e.pricing ? { pricing: e.pricing } : {}),
        ...(e.scheduleText ? { scheduleText: e.scheduleText } : {}),
      }));

    console.log(`  ✓ ${results.length} PPAP shows from Oran Mor`);
    return results;
  } catch (err) {
    console.error(`  ✗ PPAP scrape failed: ${err.message}`);
    FAILURES['oran-mor'] = err.message;
    return [];
  }
}

async function scrapeGladCafe() {
  console.log('\n🎭 Scraping The Glad Cafe...');
  const events = [];

  try {
    const html = await fetchPage('https://www.thegladcafe.co.uk/whats-on/');
    const $ = cheerio.load(html);

    // The Glad Cafe uses DICE/custom event cards
    // Look for event links and details
    const eventEls = $('a[href*="/events/"]');
    const seen = new Set();

    for (const el of eventEls.toArray()) {
      const href = $(el).attr('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const title = cleanText($(el).text()).replace(/\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Z][a-z]{2}\s+\d.*$/, '');
      if (!title || title.length < 3 || title === 'events') continue;

      const fullUrl = href.startsWith('http')
        ? href
        : `https://www.thegladcafe.co.uk${href}`;

      // Find parent container for image and date
      const parent = $(el).closest('li, article, div');
      let image = parent.find('img').first().attr('src') || null;
      if (image && !image.startsWith('http')) {
        image = `https://www.thegladcafe.co.uk${image}`;
      }

      // Get date from nearby text
      const dateText = cleanText(parent.find('time, .date, .event-date').text());

      events.push({
        title,
        url: fullUrl,
        dateText,
        image,
        // The Glad's own card is the only place it prints a price: the show
        // page is a Music Glue app that fetches its prices after loading.
        // Read from inside this card's link, not from the container around
        // it — the container holds every card, so every listing would take
        // the price of whichever one happened to come first.
        priceText: cleanText($(el).find('.EventBlock-tickets').first().text()),
        timeText: cleanText($(el).find('.EventBlock-time').first().text()),
      });
    }

    canary('glad-cafe', 'no /events/ links on the what\'s-on page', events.length > 0);
    console.log(`  Found ${events.length} event links`);

    // Every event is fetched and then judged on its description by the scope
    // check in tag-events.js. The keyword whitelist this replaces matched on
    // the title alone, before any description had been fetched, so it let in
    // anything containing "improv" — including a music improvisation night —
    // while dropping every play whose title happened not to say so.
    const theatreEvents = events;

    // Fetch individual pages for details
    const results = [];
    for (let i = 0; i < theatreEvents.length; i += 3) {
      const batch = theatreEvents.slice(i, i + 3);
      await Promise.all(
        batch.map(async (event) => {
          try {
            const pageHtml = await fetchPage(event.url);
            const $page = cheerio.load(pageHtml);

            // Get description
            const metaDesc = $page('meta[name="description"]').attr('content');
            event.title = cleanText($page('.EventDetailTitle-title').text()) || event.title;
            const intro = $page('main p').filter((_, el) => cleanText($page(el).text()).length > 80).first().text();
            const description = truncateDesc(cleanText(intro || metaDesc || `${event.title} at The Glad Cafe, Glasgow.`));

            // Get image
            let image = $page('.EventDetailImage img').attr('src') || null;
            if (!image) {
              const ogImage = $page('meta[property="og:image"]').attr('content');
              if (ogImage) image = ogImage;
            }

            // Parse date from URL slug or page content
            let date = null;
            const urlDateMatch = event.url.match(/(\d{4}-\d{2}-\d{2})/);
            if (urlDateMatch) {
              date = urlDateMatch[1];
            }
            if (!date) {
              date = parseDate(event.dateText);
            }

            if (date && date >= TODAY) {
              const type = classifyEventType(event.title, 'The Glad Cafe', description);
              // The card on the what's-on page prints the door time; the show
              // page's structured data carries the same moment in UTC. The
              // card is preferred because it is what the Glad says out loud,
              // and the structured data is the fallback.
              const [structured] = jsonLdEvents(pageHtml);
              const doors = londonMoment(structured?.doorTime || structured?.startDate);
              const listing = {
                id: makeId('glad-cafe', event.title),
                title: event.title,
                venue: 'The Glad Cafe',
                venueId: 'glad-cafe',
                date,
                // Doors, not curtain: the Glad is a room with a bar in it and
                // publishes nothing finer, so the schedule says as much.
                time: parseTime(event.timeText) || doors?.time || null,
                endDate: null,
                // The Glad publishes no category, so every listing is ambiguous.
                sourceGenre: null,
                type,
                tags: classifyTags(event.title, description, type),
                description,
                ticketUrl: event.url,
                image,
              };
              if (listing.time)
                attachSchedule(listing, [
                  { date, time: listing.time, note: 'Doors' },
                ]);
              attachPricing(listing, readPricing(event.priceText));
              results.push(listing);
            }
          } catch (err) {
            console.log(`  Warning: Could not fetch ${event.url}: ${err.message}`);
          }
        })
      );
      if (i + 3 < theatreEvents.length) await sleep(500);
    }

    console.log(`  ✓ ${results.length} candidate events from The Glad Cafe`);
    return results;
  } catch (err) {
    console.error(`  ✗ The Glad Cafe scrape failed: ${err.message}`);
    FAILURES['glad-cafe'] = err.message;
    return [];
  }
}

/**
 * Structural checks on each source page.
 *
 * A scraper that returns nothing is easy to spot. A scraper that quietly
 * returns half of what it should, because a venue renamed one class, is not:
 * the site keeps building and the listings just get thinner. Each scraper
 * declares the markers it depends on, and a missing marker is reported through
 * refresh-status.json into the daily email, whether or not events came back.
 */
const CANARIES = {};

/**
 * What a page looked like when it did not look like itself.
 *
 * A structural check that fails only says a class is missing, which is the
 * same message whether the venue redesigned or a bot wall served a challenge
 * page. The title and size distinguish them: "Just a moment..." in 2kB is
 * Cloudflare, "Attention Required" is Wordfence, and the real page at its
 * usual size is a genuine redesign.
 */
function pageShape(html) {
  if (!html) return 'no response body';
  const title = (html.match(/<title[^>]*>([^<]{0,80})/i) || [])[1] || 'untitled';
  return `${Math.round(html.length / 1024)}kB, title "${title.trim()}"`;
}

function canary(venueId, label, ok) {
  if (ok) return true;
  (CANARIES[venueId] = CANARIES[venueId] || []).push(label);
  console.log(`  ⚠ canary failed: ${label}`);
  return false;
}

// --- Cottiers ---

/**
 * A WP Event Manager install, so the markup is the plugin's and the listing
 * type is published as a class. "concert-or-performance" covers both a gig and
 * a piece of theatre, so it is left for the scope check to settle.
 */
/**
 * Cottiers prints its price as a page heading — "Standard Price : 12.50" —
 * with no currency symbol and no concession band. A zero there is a free
 * event, which is most of what the building's tours and talks are.
 */
async function cottiersTickets(url) {
  try {
    const $ = cheerio.load(await fetchShared(url));
    const heading = $('.elementor-heading-title')
      .toArray()
      .map((el) => cleanText($(el).text()))
      .find((text) => /price/i.test(text));
    const pricing = readPricing(heading);
    return pricing && (pricing.from != null || pricing.text) ? { pricing } : {};
  } catch (err) {
    console.log(`  Warning: no price for ${url}: ${err.message}`);
    return {};
  }
}

async function scrapeCottiers() {
  console.log('\n🎭 Scraping Cottiers...');
  const results = [];

  try {
    const html = await fetchPage('https://cottiers.com/whats-on-at-cottiers/');
    const $ = cheerio.load(html);
    const items = $('.event_listing');

    canary('cottiers', `no .event_listing items (${pageShape(html)})`, items.length > 0);
    canary('cottiers', '.wpem-event-title missing', $('.wpem-event-title').length > 0);
    canary('cottiers', '.wpem-event-date-time-text missing', $('.wpem-event-date-time-text').length > 0);

    for (const el of items.toArray()) {
      const $item = $(el);
      const title = cleanText($item.find('.wpem-event-title').first().text());
      const ticketUrl = $item.find('a.wpem-event-action-url').first().attr('href');
      if (!title || !ticketUrl) continue;

      // "17th September 2026 @ 06:00 PM - 08:00 PM"
      const dateTime = cleanText($item.find('.wpem-event-date-time-text').first().text());
      const [datePart, timePart] = dateTime.split('@').map((s) => (s || '').trim());
      const { startDate, endDate } = parseDateRange(datePart);
      if (!startDate) {
        console.log(`  Skipping "${title}": no date in "${dateTime}"`);
        continue;
      }

      const typeClass = String($item.attr('class') || '')
        .split(/\s+/)
        .find((c) => c.startsWith('event_listing_type-'));
      const sourceGenre = typeClass ? typeClass.slice('event_listing_type-'.length) : null;

      const style = $item.find('.wpem-event-banner-img').first().attr('style') || '';
      const image = (style.match(/url\(([^)]+)\)/) || [])[1] || null;

      const description = await describe(ticketUrl, `${title} at Cottiers, Glasgow.`);
      const type = classifyEventType(title, 'Cottiers', description);

      const listing = {
        id: makeId('cottiers', title),
        title,
        venue: 'Cottiers',
        venueId: 'cottiers',
        date: startDate,
        endDate: endDate && endDate > startDate ? endDate : null,
        time: parseTime(timePart),
        sourceGenre,
        type,
        tags: classifyTags(title, description, type),
        description,
        ticketUrl,
        image,
        // "17th September 2026 @ 06:00 PM - 08:00 PM" is start and finish, and
        // the finish is worth keeping: Cottiers programmes a lot of one-offs.
        scheduleText: timePart || null,
      };
      if (listing.time) attachSchedule(listing, [{ date: startDate, time: listing.time }]);
      Object.assign(listing, await cottiersTickets(ticketUrl));
      results.push(listing);
    }

    console.log(`  ✓ ${results.length} candidate events from Cottiers`);
    return results;
  } catch (err) {
    console.error(`  ✗ Cottiers scrape failed: ${err.message}`);
    FAILURES.cottiers = err.message;
    return [];
  }
}

// --- The Old Hairdressers ---

/**
 * Mostly a music venue, with theatre, comedy and poetry in among the gigs, so
 * every listing goes to the scope check. Dates read "Date Sunday August 30th,
 * 2026" and times "Time 7.30pm", both with the label glued to the front.
 */
async function scrapeOldHairdressers() {
  console.log('\n🎭 Scraping The Old Hairdressers...');
  const results = [];

  try {
    const html = await fetchPage('http://www.theoldhairdressers.com/');
    const $ = cheerio.load(html);
    const rows = $('.ptb_events-_row');

    canary('old-hairdressers', `no .ptb_events-_row items (${pageShape(html)})`, rows.length > 0);
    canary('old-hairdressers', '.ptb_events__date_ missing', $('.ptb_events__date_').length > 0);

    for (const el of rows.toArray()) {
      const $row = $(el);
      const link = $row.find('.ptb_post_title a').first();
      const title = cleanText(link.text());
      const permalink = link.attr('href');
      if (!title || !permalink) continue;

      const dateText = cleanText($row.find('.ptb_events__date_').first().text()).replace(/^Date\s*/i, '');
      const timeText = cleanText($row.find('.ptb_events__time_').first().text()).replace(/^Time\s*/i, '');
      const { startDate } = parseDateRange(dateText);
      if (!startDate) {
        console.log(`  Skipping "${title}": no date in "${dateText}"`);
        continue;
      }

      let image = $row.find('.ptb_post_image img').first().attr('src') || null;
      if (image && image.startsWith('//')) image = `http:${image}`;

      const description = await describe(
        permalink,
        `${title} at The Old Hairdressers, Glasgow.`,
      );
      const type = classifyEventType(title, 'The Old Hairdressers', description);

      const time = parseTime(timeText);
      results.push({
        id: makeId('old-hairdressers', title),
        title,
        venue: 'The Old Hairdressers',
        venueId: 'old-hairdressers',
        date: startDate,
        endDate: null,
        time,
        // A single night, so the time is the whole schedule. Prices live with
        // whoever is selling the tickets, which is rarely the venue.
        ...(time ? { performances: [{ date: startDate, time }] } : {}),
        // The venue publishes no category, so every listing is ambiguous.
        sourceGenre: null,
        type,
        tags: classifyTags(title, description, type),
        description,
        ticketUrl: $row.find('.ptb_events__buy_tickets a').first().attr('href') || permalink,
        image,
      });
    }

    console.log(`  ✓ ${results.length} candidate events from The Old Hairdressers`);
    return results;
  } catch (err) {
    console.error(`  ✗ The Old Hairdressers scrape failed: ${err.message}`);
    FAILURES['old-hairdressers'] = err.message;
    return [];
  }
}

// --- Description cache ---

/**
 * Show pages carry the only real description these two platforms publish, but
 * fetching one per listing on every refresh is ninety requests a day for copy
 * that rarely changes. Cached by ticket URL, like the tag cache: a show costs
 * one fetch the first time it is seen and nothing afterwards.
 */
const DESCRIPTION_CACHE_FILE = path.join(DATA_DIR, 'description-cache.json');

function readDescriptionCache() {
  try {
    return JSON.parse(fs.readFileSync(DESCRIPTION_CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const descriptionCache = readDescriptionCache();
let descriptionCacheDirty = false;

/**
 * Some venues paste markup into their own copy, which survives .text() as
 * literal angle brackets. Applied on the way out as well as the way in, so a
 * value cached before this existed is cleaned up too.
 */
function tidyDescription(text) {
  if (!text) return null;
  const stripped = cleanText(String(text).replace(/<[^>]*>/g, ' '));
  return stripped ? truncateDesc(stripped) : null;
}

/**
 * A page a couple of readers want in a row.
 *
 * An ATG show page is read twice: once for the blurb, once for the prices and
 * the performance dates. It is 300KB and there are fifty of them, so the two
 * readers share a fetch. Only the last few pages are held, because they are
 * only ever wanted back to back and a refresh reads a hundred and fifty.
 */
const recentPages = new Map();
async function fetchShared(url) {
  if (recentPages.has(url)) return recentPages.get(url);
  const html = await fetchPage(url);
  recentPages.set(url, html);
  for (const stale of [...recentPages.keys()].slice(0, -4)) recentPages.delete(stale);
  return html;
}

async function describe(url, fallback) {
  if (Object.prototype.hasOwnProperty.call(descriptionCache, url)) {
    return tidyDescription(descriptionCache[url]) || fallback;
  }
  let description = null;
  try {
    const $ = cheerio.load(await fetchShared(url));
    description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      null;

    // Some venues publish neither meta tag, and the copy is only in the page.
    // The longest paragraph is a crude but reliable stand-in for the blurb.
    if (!description) {
      let longest = '';
      $('p').each((_, el) => {
        const text = cleanText($(el).text());
        if (text.length > longest.length) longest = text;
      });
      if (longest.length > 80) description = longest;
    }

    description = tidyDescription(description);
  } catch (err) {
    // A missing description is not worth failing a listing over.
    console.log(`  Warning: no description for ${url}: ${err.message}`);
    return fallback;
  }
  descriptionCache[url] = description;
  descriptionCacheDirty = true;
  return description || fallback;
}

function saveDescriptionCache() {
  if (!descriptionCacheDirty) return;
  fs.writeFileSync(DESCRIPTION_CACHE_FILE, JSON.stringify(descriptionCache, null, 2) + '\n');
}

/**
 * Slice a payload into one window per record.
 *
 * Windows used to be a fixed number of characters, which is only safe while
 * every record is longer than the window. Neither of these payloads is: the
 * Pavilion's is half real cards and half compact analytics blocks carrying the
 * same eventGroupId, so a fixed window read straight through its own record
 * into the next few and took whichever field it found first. That is how
 * Russell Howard ended up with Tam Cowan's artwork.
 */
function payloadWindows(payload, anchor) {
  const starts = [];
  const re = new RegExp(anchor, 'g');
  let match;
  while ((match = re.exec(payload))) starts.push(match.index);
  return starts.map((start, i) =>
    payload.slice(start, i + 1 < starts.length ? starts[i + 1] : payload.length),
  );
}

// --- ATG venues (King's Theatre, Theatre Royal) ---

const ATG_VENUES = [
  { slug: 'kings-theatre-glasgow', venueId: 'kings', venue: "King's Theatre" },
  { slug: 'theatre-royal-glasgow', venueId: 'theatre-royal', venue: 'Theatre Royal' },
];

const ATG_ACCESS_LABELS = {
  audioDescribed: 'Audio-described performances available',
  signed: 'BSL-interpreted performances available',
  captioned: 'Captioned performances available',
  relaxed: 'Relaxed performances available',
  touchTour: 'Touch tours available',
};

/** Cloudinary serves whatever width is asked for; the cards ask for thumbnails. */
function atgImage(window) {
  const match = window.match(/https:\/\/res\.cloudinary\.com\/[^"\\]+/);
  return match ? match[0].replace(/w_\d+/, 'w_800') : null;
}

/**
 * ATG renders its listings into the React Server Component payload rather than
 * into the HTML, so the cards are read out of the embedded JSON. robots.txt
 * explicitly allows the paginated what's-on URLs this walks.
 */
/**
 * Prices and performances from an ATG show page.
 *
 * ATG's what's-on payload carries no price and no time at all — only a run's
 * opening and closing dates. The show page emits one TheaterEvent per
 * performance, each with the cheapest seat on sale for that night, which is
 * exactly the "from" price a listing wants, and it varies: a Friday is £39.50
 * where the Tuesday is £19.
 *
 * It publishes only the next nine or so performances of a long run, so a
 * pantomime's January dates are missing. The schedule is marked partial and
 * the page says so rather than implying the run ends when the list does.
 */
async function atgTickets(url) {
  const out = {};
  try {
    const shows = jsonLdEvents(await fetchShared(url));
    const performances = [];
    const prices = [];
    let duration = null;
    for (const show of shows) {
      const when = londonMoment(show.startDate);
      if (!when) continue;
      duration = duration || readDuration(show.duration);
      const cheapest = offersOf(show)
        .map((o) => Number(o.price))
        .filter((n) => Number.isFinite(n) && n > 0);
      const price = cheapest.length ? Math.min(...cheapest) : null;
      if (price != null) prices.push(price);
      performances.push({ ...when, url: offersOf(show)[0]?.url || null, price });
    }
    // Nine on the nose is ATG's page limit, not a nine-performance run.
    attachSchedule(out, performances, { partial: performances.length >= 9 });
    if (prices.length) {
      const from = Math.min(...prices);
      const to = Math.max(...prices);
      attachPricing(
        out,
        {
          from,
          to: to > from ? to : null,
          concession: null,
          concessionTo: null,
          free: false,
          payWhatYouLike: false,
          text: null,
          // Not a face value: ATG prices dynamically and quotes what is left,
          // fees included. A page showing this has to date it.
          live: true,
        },
        {
          notes: 'The cheapest seat still on sale for each performance, fees included. ATG prices by demand, so this moves as a run sells and a weekend costs more than a midweek night.',
          duration,
        },
      );
    } else if (duration) {
      out.duration = duration;
    }
  } catch (err) {
    console.log(`  Warning: no prices or times for ${url}: ${err.message}`);
  }
  return out;
}

async function scrapeATG({ slug, venueId, venue }) {
  console.log(`\n🎭 Scraping ${venue}...`);
  const results = [];

  try {
    for (let page = 1; page <= 6; page++) {
      const url = `https://www.atgtickets.com/venues/${slug}/whats-on/${page > 1 ? `?page=${page}` : ''}`;
      let payload;
      try {
        payload = (await fetchPage(url)).replace(/\\"/g, '"');
      } catch (err) {
        // ATG answers 404 for the page after the last one, which is how the
        // walk ends. On the first page it is a real failure.
        if (page > 1 && /HTTP 404/.test(err.message)) break;
        throw err;
      }

      const windows = payloadWindows(payload, '"id":"show_[0-9a-f-]+"');
      if (page === 1) {
        canary(venueId, 'no show objects in the ATG payload', windows.length > 0);
        canary(venueId, '"buyTickets" missing from the ATG payload', payload.includes('"buyTickets"'));
        canary(venueId, '"dates" missing from the ATG payload', payload.includes('"dates"'));
      }
      if (!windows.length) break;

      for (const window of windows) {
        const title = cleanText((window.match(/"title":"((?:[^"\\]|\\.)*)"/) || [])[1] || '');
        const dates = (window.match(/"dates":"((?:[^"\\]|\\.)*)"/) || [])[1];
        const ticketPath = (window.match(/"buyTickets":\{[^}]*?"url":"([^"]+)"/) || [])[1];
        if (!title || !dates || !ticketPath) continue;

        const { startDate, endDate } = parseDateRange(dates);
        if (!startDate) {
          console.log(`  Warning: unparsed dates "${dates}" for ${title}`);
          continue;
        }

        const genre = (window.match(/"genre":\[([^\]]*)\]/) || [])[1];
        const sourceGenre = genre ? cleanText(genre.replace(/"/g, '').split(',')[0]) : null;

        // The access icons are the only structured accessibility data any of
        // these venues publish, so they are worth carrying through.
        const access = [...window.matchAll(/"type":"([a-zA-Z]+)","tooltip"/g)]
          .map((m) => ATG_ACCESS_LABELS[m[1]])
          .filter(Boolean);

        results.push({
          title,
          venue,
          venueId,
          date: startDate,
          endDate,
          time: null,
          sourceGenre,
          ticketUrl: `https://www.atgtickets.com${ticketPath}`,
          moreInfoUrl: (window.match(/"moreInfo":\{[^}]*?"url":"([^"]+)"/) || [])[1] || null,
          image: atgImage(window),
          accessibility: [...new Set(access)],
        });
      }

      await sleep(500);
    }

    // Descriptions come from the show pages, one fetch per show, then cached.
    for (const event of results) {
      const fallback = `${event.title} at ${event.venue}, Glasgow.`;
      event.description = event.moreInfoUrl
        ? await describe(`https://www.atgtickets.com${event.moreInfoUrl}`, fallback)
        : fallback;
      if (event.moreInfoUrl)
        Object.assign(event, await atgTickets(`https://www.atgtickets.com${event.moreInfoUrl}`));
      delete event.moreInfoUrl;
      event.type = classifyEventType(event.title, event.venue, event.description);
      event.tags = classifyTags(event.title, event.description, event.type);
      event.id = makeId(event.venueId, event.title);
      if (!event.accessibility.length) delete event.accessibility;
    }

    console.log(`  ✓ ${results.length} events from ${venue}`);
    return results;
  } catch (err) {
    console.error(`  ✗ ${venue} scrape failed: ${err.message}`);
    FAILURES[venueId] = err.message;
    return [];
  }
}

// --- Pavilion Theatre (Trafalgar Tickets) ---

/**
 * The Pavilion's own domain redirects to Trafalgar's ticketing platform, which
 * embeds the whole programme in one page as event cards, with a machine
 * readable startDate. No pagination and no date parsing needed. Card hrefs are
 * relative to the venue's own path, not to the domain root.
 */
const PAVILION_BASE = 'https://trafalgartickets.com/pavilion-theatre-glasgow/en-GB';

/**
 * Prices and performances from a Trafalgar show page.
 *
 * One structured-data block per show, with an offer per performance. The
 * performance time is the offer's `validThrough` — selling for a night stops
 * when its curtain goes up — which is the only place a Pavilion time appears
 * at all.
 *
 * With one performance there is nothing to distinguish, and Trafalgar closes
 * that single offer at the end of the show instead: a 7.30pm tribute night
 * reads as 10pm. So a `validThrough` that lands exactly on the event's own
 * end is not a curtain time, and the show's start is used instead.
 */
async function pavilionTickets(url) {
  const out = {};
  try {
    const [show] = jsonLdEvents(await fetchShared(url));
    if (!show) return out;
    const performances = [];
    const prices = [];
    for (const offer of offersOf(show)) {
      const closes = offer.validThrough && offer.validThrough !== show.endDate ? offer.validThrough : null;
      const when = londonMoment(closes) || londonMoment(show.startDate);
      const price = Number(offer.price);
      if (Number.isFinite(price) && price > 0) prices.push(price);
      if (when) performances.push({ ...when, url: offer.url || null, price: Number.isFinite(price) ? price : null });
    }
    attachSchedule(out, performances);
    if (prices.length) {
      const from = Math.min(...prices);
      const to = Math.max(...prices);
      attachPricing(
        out,
        {
          from,
          to: to > from ? to : null,
          concession: null,
          concessionTo: null,
          free: false,
          payWhatYouLike: false,
          text: null,
          live: true,
        },
        { notes: 'The cheapest seat still on sale for each performance. Some shows include a venue levy of up to £2 in the ticket price.' },
      );
    }
  } catch (err) {
    console.log(`  Warning: no prices or times for ${url}: ${err.message}`);
  }
  return out;
}

async function scrapePavilion() {
  console.log('\n🎭 Scraping Pavilion Theatre...');

  try {
    const payload = (await fetchPage(`${PAVILION_BASE}/whats-on`)).replace(/\\"/g, '"');

    // Half of these carry the same eventGroupId but are tracking payloads with
    // no artwork, link or date. A card is the one with somewhere to click.
    const windows = payloadWindows(payload, '"eventGroupId":\\d+').filter(
      (window) => window.includes('"href":"/event/') && window.includes('"startDate"'),
    );

    canary('pavilion', 'no event cards in the Trafalgar payload', windows.length > 0);
    canary('pavilion', 'eventCards missing', payload.includes('eventCards'));
    canary('pavilion', 'startDate missing from the Trafalgar payload', payload.includes('"startDate"'));

    const seen = new Set();
    const results = [];

    for (const window of windows) {
      const title = cleanText((window.match(/"title":"((?:[^"\\]|\\.)*)"/) || [])[1] || '');
      const href = (window.match(/"href":"([^"]+)"/) || [])[1];
      const start = (window.match(/"startDate":"\$D([^"]+)"/) || [])[1];
      if (!title || !href || !start || seen.has(href)) continue;
      seen.add(href);

      // The card's own dates string is the only place a run's closing date appears.
      const dates = cleanText(((window.match(/"dates":"((?:[^"\\]|\\.)*)"/) || [])[1] || '').replace(/\\n/g, ' '));
      const { endDate } = parseDateRange(dates);

      const date = start.slice(0, 10);
      const category = (window.match(/"categories":\["([^"]+)"/) || [])[1] || null;
      const image =
        (window.match(/"heroImageUrl":\{"src":"([^"]+)"/) || [])[1] ||
        (window.match(/"image":\{"src":"([^"]+)"/) || [])[1] ||
        null;

      results.push({
        title,
        venue: 'Pavilion Theatre',
        venueId: 'pavilion',
        date,
        endDate: endDate && endDate > date ? endDate : null,
        time: null,
        sourceGenre: category,
        ticketUrl: `${PAVILION_BASE}${href}`,
        image,
      });
    }

    for (const event of results) {
      const fallback = `${event.title} at the Pavilion Theatre, Glasgow.`;
      event.description = await describe(event.ticketUrl, fallback);
      Object.assign(event, await pavilionTickets(event.ticketUrl));
      event.type = classifyEventType(event.title, event.venue, event.description);
      event.tags = classifyTags(event.title, event.description, event.type);
      event.id = makeId(event.venueId, event.title);
    }

    console.log(`  ✓ ${results.length} events from Pavilion Theatre`);
    return results;
  } catch (err) {
    console.error(`  ✗ Pavilion scrape failed: ${err.message}`);
    FAILURES.pavilion = err.message;
    return [];
  }
}

// --- Platform, Easterhouse ---

/**
 * Platform publishes no year on a listing: the date reads "Sat 19 Sep - Sat 28
 * Nov" and the year lives in the item's own class names, as evmon-October-2026.
 * Those classes are the only reliable year source, so they are read first and
 * grafted onto the date text before it is parsed.
 */
function platformMonthYears($item) {
  const years = {};
  for (const cls of String($item.attr('class') || '').split(/\s+/)) {
    const m = cls.match(/^evmon-([A-Za-z]+)-(\d{4})$/);
    if (m) years[m[1].toLowerCase().slice(0, 3)] = m[2];
  }
  return years;
}

/**
 * The first line of the excerpt is the date, in whatever shape the listing was
 * typed in: arrows for ranges, "@" or "|" before times, and sometimes no date
 * at all ("Fridays", "Various dates & times"), which returns null.
 */
function platformDates(dateText, monthYears) {
  let text = dateText.replace(/[→–—]/g, '-').replace(/\s+/g, ' ').trim();
  text = text.split(/[|@]/)[0].trim();
  if (!/\d/.test(text)) return { startDate: null, endDate: null };

  text = text.replace(/(\d{1,2})\s+([A-Za-z]{3,9})(?!\s+\d{4})/g, (whole, day, month) => {
    const year = monthYears[month.toLowerCase().slice(0, 3)];
    return year ? `${day} ${month} ${year}` : whole;
  });

  return parseDateRange(text);
}

async function scrapePlatform() {
  console.log('\n🎭 Scraping Platform...');
  const results = [];

  try {
    const html = await fetchPage('https://www.platform-online.co.uk/whats-on');
    const $ = cheerio.load(html);

    canary('platform', `no .listings__item--event items (${pageShape(html)})`,
      $('.listings__item--event').length > 0);
    canary('platform', 'no evmon- year classes, so no year to infer',
      /evmon-[A-Za-z]+-\d{4}/.test(html));

    for (const el of $('.listings__item--event').toArray()) {
      const $item = $(el);
      const link = $item.find('.listings__header a').first();
      const title = cleanText(link.text());
      const ticketUrl = link.attr('href');
      if (!title || !ticketUrl) continue;

      const excerptHtml = $item.find('.listings__excerpt').html() || '';
      const lines = excerptHtml
        .split(/<br\s*\/?>/i)
        .map((part) => cleanText(cheerio.load(`<div>${part}</div>`).text()))
        .filter(Boolean);
      const dateText = lines[0] || '';
      const { startDate, endDate } = platformDates(dateText, platformMonthYears($item));
      if (!startDate) {
        console.log(`  Skipping "${title}": no date in "${dateText}"`);
        continue;
      }

      // Platform tags its own listings; Performance is the one that needs no
      // second opinion. Wellbeing, Visual and the rest go to the scope check.
      const categories = String($item.attr('class') || '')
        .split(/\s+/)
        .filter((c) => /^cat-/.test(c))
        .map((c) => c.slice(4))
        .filter((c) => !/^mie-/.test(c));
      const sourceGenre = categories.includes('Performance')
        ? 'Performance'
        : categories[0] || null;

      let image = $item.find('img[data-src]').first().attr('data-src') || null;
      if (image && !image.startsWith('http')) {
        image = `https://www.platform-online.co.uk${image}`;
      }

      // Platform's excerpt is a fixed little stack: when, then who it is for,
      // then what it costs, then the blurb. The price line is whichever one
      // carries money or says the activity is free or pay-what-you-like —
      // never the age line, which is full of numbers that are not prices.
      const priceLine = lines
        .slice(1)
        .find((line) => /£|\bfree\b|pay[- ]what[- ]you/i.test(line) && line.length < 90);

      // The first three lines now have places of their own on the page, so
      // the description is what follows them. Leaving them in printed a
      // show's dates and prices three times over on one page.
      const blurb = lines.slice(priceLine ? lines.indexOf(priceLine) + 1 : 1);
      const description = truncateDesc(
        cleanText(blurb.join(' ')) ||
          cleanText($item.find('.listings__excerpt').text()) ||
          `${title} at Platform, Easterhouse.`,
      );
      const type = classifyEventType(title, 'Platform', description);

      const listing = {
        id: makeId('platform', title),
        title,
        venue: 'Platform',
        venueId: 'platform',
        date: startDate,
        endDate: endDate && endDate > startDate ? endDate : null,
        time: parseTime(dateText),
        sourceGenre,
        type,
        tags: classifyTags(title, description, type),
        description,
        ticketUrl,
        image,
        // "Tue 1 Dec - Thu 24 Dec | Day & evening shows" says more about when
        // a Platform show runs than any single time could.
        scheduleText: dateText || null,
      };
      attachPricing(listing, readPricing(priceLine));
      results.push(listing);
    }

    console.log(`  ✓ ${results.length} candidate events from Platform`);
    return results;
  } catch (err) {
    console.error(`  ✗ Platform scrape failed: ${err.message}`);
    FAILURES.platform = err.message;
    return [];
  }
}

async function scrapeEventbrite() {
  console.log('\n🎭 Scraping Eventbrite Glasgow Theatre...');

  // Eventbrite is heavily JS-rendered. The initial HTML may contain some
  // server-rendered content, but most event data loads via API calls.
  // We'll try to scrape what we can from the initial HTML.

  try {
    const html = await fetchPage(
      'https://www.eventbrite.co.uk/d/united-kingdom--glasgow/theatre/'
    );
    const $ = cheerio.load(html);
    const events = [];

    // Look for event cards - Eventbrite uses various structures
    const eventLinks = $('a[href*="eventbrite.co.uk/e/"]');
    const seen = new Set();

    for (const el of eventLinks.toArray()) {
      const href = $(el).attr('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);

      // Find the event card container
      const $el = $(el);
      const parent = $el.closest('li, article, div[class*="event"], section');

      let title = cleanText($el.find('h3, h2').text()) || cleanText($el.text());
      if (!title || title.length < 5 || title.length > 200) continue;

      let image = parent.find('img').first().attr('src') || null;
      const dateText = cleanText(parent.find('p, time, [class*="date"]').first().text());

      // Parse date
      let date = parseDate(dateText);

      // Try extracting venue
      const venueText = cleanText(
        parent
          .find('[class*="venue"], [class*="location"]')
          .first()
          .text()
      );

      if (date && date >= TODAY) {
        events.push({
          id: makeId('eb', title),
          title,
          venue: venueText || 'Various Glasgow Venues',
          venueId: 'various',
          date,
          time: parseTime(dateText),
          endDate: null,
          type: 'professional',
          tags: classifyTags(title, '', 'professional'),
          description: `${title}. Find tickets and more information on Eventbrite.`,
          ticketUrl: href,
          image,
        });
      }
    }

    console.log(`  ✓ ${events.length} events from Eventbrite`);
    return events;
  } catch (err) {
    console.error(`  ✗ Eventbrite scrape failed: ${err.message}`);
    FAILURES['various'] = err.message;
    console.error(
      '  Note: Eventbrite is heavily JS-rendered and may not scrape well with cheerio.'
    );
    return [];
  }
}

// Theatre Scotland is a simple list format without images or descriptions.
// We note it here but it provides minimal data for our needs.
// async function scrapeTheatreScotland() { ... }

// --- Main ---

async function main() {
  console.log('='.repeat(50));
  console.log('Glasgow Theatre Event Scraper');
  console.log('='.repeat(50));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Filtering for events from: ${TODAY}`);

  // Run all scrapers
  const [
    citizens, tron, tramway, ppap, gladCafe,
    kings, theatreRoyal, pavilion, platform, cottiers, oldHairdressers,
  ] = await Promise.all([
      scrapeCitizens(),
      scrapeTron(),
      scrapeTramway(),
      scrapePlayPiePint(),
      scrapeGladCafe(),
      scrapeATG(ATG_VENUES[0]),
      scrapeATG(ATG_VENUES[1]),
      scrapePavilion(),
      scrapePlatform(),
      scrapeCottiers(),
      scrapeOldHairdressers(),
    ]);

  saveDescriptionCache();

  let allEvents = [
    ...citizens,
    ...tron,
    ...tramway,
    ...ppap,
    ...gladCafe,
    ...kings,
    ...theatreRoyal,
    ...pavilion,
    ...platform,
    ...cottiers,
    ...oldHairdressers,
  ];

  console.log('\n' + '='.repeat(50));
  console.log('Deduplication & Cleanup');
  console.log('='.repeat(50));
  console.log(`Total events before dedup: ${allEvents.length}`);

  // Deduplicate by title similarity
  const deduped = [];
  const seenTitles = new Set();

  // Sort by venue priority (prefer main venues over Eventbrite)
  allEvents.sort((a, b) => {
    const priority = {
      citizens: 0, tron: 1, tramway: 2, 'oran-mor': 3, 'glad-cafe': 4,
      kings: 5, 'theatre-royal': 6, pavilion: 7, platform: 8,
      cottiers: 9, 'old-hairdressers': 10, various: 11,
    };
    return (priority[a.venueId] ?? 99) - (priority[b.venueId] ?? 99);
  });

  // Keyed by venue as well as title: a touring show plays more than one house,
  // and "Building And Heritage Tours" runs at both ATG venues under one name.
  // Keying on the title alone silently dropped the second listing.
  for (const event of allEvents) {
    const key = `${event.venueId}|${event.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (seenTitles.has(key)) {
      console.log(`  Removing duplicate: "${event.title}" (${event.venue})`);
      continue;
    }
    seenTitles.add(key);
    deduped.push(event);
  }

  // Applied here rather than per scraper so every venue is cut off alike.
  const horizon = (() => {
    const d = new Date(`${TODAY}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + HORIZON_MONTHS);
    return d.toISOString().slice(0, 10);
  })();
  const beyond = deduped.filter((e) => e.date > horizon);
  if (beyond.length) {
    console.log(`  Beyond the ${HORIZON_MONTHS}-month horizon (${horizon}): ${beyond.length}`);
  }
  for (let i = deduped.length - 1; i >= 0; i--) {
    if (deduped[i].date > horizon) deduped.splice(i, 1);
  }

  // Sort by date
  deduped.sort((a, b) => a.date.localeCompare(b.date));

  // Assign sequential IDs
  deduped.forEach((event, i) => {
    event.id = `evt${String(i + 1).padStart(3, '0')}`;
  });

  console.log(`Total events after dedup: ${deduped.length}`);

  // Keep last known upcoming listings if a source is unavailable or returns no events.
  const previous = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  const refreshedVenues = new Set(deduped.map(e => e.venueId));
  const retained = previous.filter(e => !refreshedVenues.has(e.venueId) && isFutureEvent(e));
  // A source that neither threw nor returned anything is a silent breakage:
  // the page loaded and parsed, and yielded nothing. Worth saying so.
  for (const id of ALL_SOURCES) {
    if (!refreshedVenues.has(id) && !FAILURES[id]) {
      canary(id, 'the scrape returned no events at all');
    }
  }

  const report = {
    refreshedAt: new Date().toISOString(),
    counts: Object.fromEntries(
      [...refreshedVenues].map((id) => [id, deduped.filter((e) => e.venueId === id).length]),
    ),
    retainedVenues: [...new Set(retained.map((e) => e.venueId))],
    failures: FAILURES,
    canaries: CANARIES,
  };
  if (!deduped.length) throw new Error('No sources returned events; keeping existing data.');
  deduped.forEach(e => { e.checkedAt = TODAY; e.id = makeId(e.venueId, e.title); });
  deduped.push(...retained);
  deduped.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(path.join(DATA_DIR, 'refresh-status.json'), JSON.stringify(report, null, 2) + '\n');
  // Write to events.json
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(deduped, null, 2) + '\n');
  console.log(`\n✓ Written ${deduped.length} events to ${EVENTS_FILE}`);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Summary by venue:');
  const venueCount = {};
  for (const e of deduped) {
    venueCount[e.venue] = (venueCount[e.venue] || 0) + 1;
  }
  for (const [venue, count] of Object.entries(venueCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${venue}: ${count} events`);
  }

  console.log('\nSummary by type:');
  const typeCount = {};
  for (const e of deduped) {
    typeCount[e.type] = (typeCount[e.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count} events`);
  }

  const withImages = deduped.filter((e) => e.image).length;
  console.log(`\nEvents with images: ${withImages}/${deduped.length}`);
  console.log('='.repeat(50));
}

module.exports = { parseTime, parseDateRange, classifyTags, platformDates, londonMoment, jsonLdEvents };

if (require.main === module) main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
