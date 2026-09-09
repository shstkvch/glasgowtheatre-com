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
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const { londonDate } = require('../src/js/listings');
const TODAY = londonDate();

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

function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
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

function classifyTags(title, description, type) {
  const tags = [];
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes('comedy') || text.includes('stand-up') || /\bimprov comedy\b/.test(text) || text.includes('funny')) tags.push('comedy');
  if (/\bmusical(?: theatre)?\b/.test(text) || title === 'Guys and Dolls') tags.push('musical');
  if (text.includes('dance') || text.includes('choreograph')) tags.push('dance');
  if (text.includes('drama')) tags.push('drama');
  if (/\bfamily[- ]friendly\b|\bfor (?:children|families|kids)\b|\bchildren[’']s (?:show|theatre)\b/.test(text)) tags.push('family');
  if (text.includes('classic') || text.includes('greek') || text.includes('shakespeare') || text.includes('beckett') || text.includes('euripides') || text.includes('lorca')) tags.push('classic');
  if (text.includes('new writing') || text.includes('new play')) tags.push('new-writing');
  if (text.includes('experimental') || text.includes('performance art')) tags.push('experimental');
  if (text.includes('scottish') || text.includes('scotland') || text.includes('glasgow')) tags.push('scottish');
  if (/\btouring\b|\bon tour\b/.test(text)) tags.push('touring');
  if (/\bmusic\b/.test(text) && !tags.includes('musical') && !tags.includes('dance')) tags.push('music');
  if (['1984', 'Antigone', 'Othello', 'Death of a Salesman'].includes(title)) tags.push('drama', 'classic');
  if (type === 'professional' && tags.length === 0) tags.push('drama');
  if (tags.length === 0) tags.push(type);
  return [...new Set(tags)];
}

// --- Scrapers ---

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
          time: null, // Runs have varying curtain times; check the venue.
          endDate: e.endDate,
          type,
          tags: classifyTags(e.title, e.description || '', type),
          description: e.description || `${e.title} at Citizens Theatre, Glasgow.`,
          ticketUrl: e.url,
          image: e.image,
        };
      });

    console.log(`  ✓ ${results.length} events from Citizens Theatre`);
    return results;
  } catch (err) {
    console.error(`  ✗ Citizens Theatre scrape failed: ${err.message}`);
    return [];
  }
}

async function scrapeTron() {
  console.log('\n🎭 Scraping Tron Theatre...');
  const events = [];

  try {
    const html = await fetchPage('https://www.tron.co.uk/whats-on/');
    const $ = cheerio.load(html);

    // Title links and image divs are separate elements. Collect them independently
    // and match by index (they appear in the same order in the DOM).
    const titleLinks = $('.event_title a');
    const imageDivs = $('div.event-image.loop-image');
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
              events.push({
                title: show.title,
                url: show.url,
                date: firstDate,
                endDate: lastDate,
                time: time || null,
                image: show.image,
                description: description || `${show.title} at Tron Theatre, Glasgow.`,
              });
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
        };
      });

    console.log(`  ✓ ${results.length} events from Tron Theatre`);
    return results;
  } catch (err) {
    console.error(`  ✗ Tron Theatre scrape failed: ${err.message}`);
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

            // Look for description in the page
            event.time = parseTime($page('.event-details__time').first().text());
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
        };
      });

    console.log(`  ✓ ${results.length} events from Tramway`);
    return results;
  } catch (err) {
    console.error(`  ✗ Tramway scrape failed: ${err.message}`);
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
              events.push({
                title: show.title,
                url: show.url,
                date: startDate,
                endDate,
                time: parseTime($page('.opening-times').first().text().split('(')[0]),
                image: show.image,
                description: description || `A Play, A Pie and A Pint: ${show.title} at Oran Mor, Glasgow.`,
              });
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
        date: e.date,
        time: e.time || null,
        endDate: e.endDate,
        type: 'new-writing',
        tags: ['new-writing', ...(e.time === '13:00' ? ['lunchtime'] : ['scratch']), 'a-play-a-pie-a-pint'],
        description: e.description,
        ticketUrl: e.url,
        image: e.image,
      }));

    console.log(`  ✓ ${results.length} PPAP shows from Oran Mor`);
    return results;
  } catch (err) {
    console.error(`  ✗ PPAP scrape failed: ${err.message}`);
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
      });
    }

    console.log(`  Found ${events.length} event links`);

    // Filter for theatre/comedy/performance events
    const theatreKeywords = [
      'theatre', 'comedy', 'cabaret', 'spoken word', 'scratch', 'performance',
      'improv', 'drama', 'play', 'crossmylaff',
    ];

    const theatreEvents = events.filter((e) => {
      const text = e.title.toLowerCase();
      return theatreKeywords.some((k) => text.includes(k));
    });

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
              results.push({
                id: makeId('glad-cafe', event.title),
                title: event.title,
                venue: 'The Glad Cafe',
                venueId: 'glad-cafe',
                date,
                time: null, // Page time is doors opening, not necessarily the performance.
                endDate: null,
                type,
                tags: classifyTags(event.title, description, type),
                description,
                ticketUrl: event.url,
                image,
              });
            }
          } catch (err) {
            console.log(`  Warning: Could not fetch ${event.url}: ${err.message}`);
          }
        })
      );
      if (i + 3 < theatreEvents.length) await sleep(500);
    }

    console.log(`  ✓ ${results.length} theatre events from The Glad Cafe`);
    return results;
  } catch (err) {
    console.error(`  ✗ The Glad Cafe scrape failed: ${err.message}`);
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
  const [citizens, tron, tramway, ppap, gladCafe, eventbrite] = await Promise.all([
    scrapeCitizens(),
    scrapeTron(),
    scrapeTramway(),
    scrapePlayPiePint(),
    scrapeGladCafe(),
    Promise.resolve([]),
  ]);

  let allEvents = [...citizens, ...tron, ...tramway, ...ppap, ...gladCafe, ...eventbrite];

  console.log('\n' + '='.repeat(50));
  console.log('Deduplication & Cleanup');
  console.log('='.repeat(50));
  console.log(`Total events before dedup: ${allEvents.length}`);

  // Deduplicate by title similarity
  const deduped = [];
  const seenTitles = new Set();

  // Sort by venue priority (prefer main venues over Eventbrite)
  allEvents.sort((a, b) => {
    const priority = { citizens: 0, tron: 1, tramway: 2, 'oran-mor': 3, 'glad-cafe': 4, various: 5 };
    return (priority[a.venueId] ?? 99) - (priority[b.venueId] ?? 99);
  });

  for (const event of allEvents) {
    const key = event.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (seenTitles.has(key)) {
      console.log(`  Removing duplicate: "${event.title}" (${event.venue})`);
      continue;
    }
    seenTitles.add(key);
    deduped.push(event);
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
  const report = { refreshedAt: new Date().toISOString(), counts: Object.fromEntries([...refreshedVenues].map(id => [id, deduped.filter(e => e.venueId === id).length])), retainedVenues: [...new Set(retained.map(e => e.venueId))] };
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

module.exports = { parseTime, parseDateRange, classifyTags };

if (require.main === module) main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
