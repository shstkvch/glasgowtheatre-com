/**
 * Ticket prices and performance times.
 *
 * Every venue publishes prices as a sentence rather than a number: "£14 -
 * £43.50", "£20/£12", "Previews: £16 | Main Run: £19, £23 or £26", "£10.50
 * (standard) | £7 (concession) | £6". This module turns any of those into the
 * same small shape, and turns that shape back into the one line a card or a
 * calendar bar has room for.
 *
 * Two rules run through it. The published wording is always kept verbatim, so
 * a detail page can show what the venue actually said rather than this file's
 * reading of it. And a figure is never invented: where nothing was published
 * the answer is null and the site says "check with the venue".
 *
 * Loaded by the scraper and the build alike, so it stays dependency-free.
 */
(function (root) {
  "use strict";

  /** A price is a reduction when its own words say so. Anything else — a
      preview, a weekday, a band — is a standard price at a different level. */
  const REDUCED = /\b(conc(ession)?s?|concessionary|student|unwaged|unemployed|claimant|senior|60\+?|over 60s?|child(ren)?|under[- ]?\d+|u\d+s?|young|schools?|low income|local links|access|companion|reduced|discount(ed)?)\b/i;
  /** Words that mark a price as the full one, so a bare figure beside it is
      not mistaken for the cheap seats. */
  const STANDARD = /\b(standard|full|adult|top price|normal)\b/i;
  const FREE = /\b(free|no charge|free entry|free admission)\b/i;
  const PWYL = /\b(pay[- ]what[- ]you[- ](like|want|can|decide)|pwyl|choose what you pay|pay as you feel)\b/i;

  /** £43.50 keeps its pence; £14.00 and £14 both read as £14. */
  function money(value) {
    if (value == null || Number.isNaN(value)) return null;
    const rounded = Math.round(value * 100) / 100;
    return "£" + (Number.isInteger(rounded) ? rounded : rounded.toFixed(2));
  }

  /** 19:30 as Glasgow says it out loud. */
  function clockTime(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return null;
    const [h, m] = value.split(":").map(Number);
    const hour = h % 12 || 12;
    const suffix = h >= 12 ? "pm" : "am";
    if (m === 0 && hour === 12 && h === 12) return "noon";
    return m === 0 ? `${hour}${suffix}` : `${hour}.${String(m).padStart(2, "0")}${suffix}`;
  }

  /**
   * The figures in a price sentence. A £ sign is what makes a number a price:
   * without it "7.30" is a curtain time and "2026" is a year. Cottiers is the
   * exception — its plugin prints "Standard Price : 12.50" with no symbol —
   * so a number is also a price when a price word introduces it.
   */
  function numbers(text) {
    const marked = [...String(text).matchAll(/£\s*(\d+(?:\.\d{1,2})?)/g)].map((m) =>
      Number(m[1]),
    );
    if (marked.length) return marked;
    return [
      ...String(text).matchAll(/\b(?:prices?|costs?|tickets?)\s*:?\s*(\d+(?:\.\d{1,2})?)\b/gi),
    ].map((m) => Number(m[1]));
  }

  /**
   * Split a price sentence into the parts a reader would treat separately.
   * Ranges keep their dash — "£14 - £43.50" is one band, not two prices — so
   * only the separators a venue uses between *different* tickets are cut on.
   */
  const segments = (text) =>
    String(text)
      .split(/\s*(?:\||;|\n|\r|,| or )\s*/)
      .map((part) => part.trim())
      .filter(Boolean);

  /**
   * Read whatever a venue published into { from, to, concession, ... }.
   *
   * `from` and `to` bracket the standard prices; `concession` is the cheapest
   * price the venue marked as a reduction. Where the two cannot be told apart
   * the figures all count as standard, which errs towards quoting a higher
   * price than someone might actually pay rather than a lower one.
   */
  function readPricing(text, extra = {}) {
    // Spaces collapse but line breaks stay: a venue that lists a price a line
    // is saying those are separate tickets, and running them together turns
    // "Monday: £17 / Saturday: £22.50" into one unreadable sentence.
    const raw = String(text || "")
      .replace(/[^\S\n]+/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    const pricing = {
      from: null,
      to: null,
      concession: null,
      concessionTo: null,
      free: false,
      payWhatYouLike: false,
      text: raw || null,
      ...extra,
    };
    if (!raw) return pricing.text || pricing.from != null ? pricing : null;

    if (PWYL.test(raw)) pricing.payWhatYouLike = true;

    const all = numbers(raw);
    // "Standard Price : 0.00" is how one plugin says a free event, and a
    // listing whose only figure is zero is not a listing with a £0 ticket.
    if (!all.length || all.every((n) => n === 0)) {
      if (FREE.test(raw) || (all.length && all.every((n) => n === 0))) {
        pricing.free = true;
        pricing.from = 0;
      }
      return pricing;
    }

    // "£20/£12" with nothing else said is the oldest shorthand in British
    // theatre: full price, then the concession.
    const pair = raw.match(/^£\s*(\d+(?:\.\d{1,2})?)\s*\/\s*£\s*(\d+(?:\.\d{1,2})?)\s*$/);
    if (pair) {
      const [full, reduced] = [Number(pair[1]), Number(pair[2])];
      pricing.from = Math.max(full, reduced);
      pricing.concession = Math.min(full, reduced);
      if (full === reduced) pricing.concession = null;
      return pricing;
    }

    const standard = [];
    const reduced = [];
    // Platform lists "£10.50 (standard) | £7 (concession) | £6": the bare
    // figure at the end is another reduction, not a third full price. Once a
    // list has turned to reductions it does not turn back.
    let reducedSoFar = false;
    for (const segment of segments(raw)) {
      const found = numbers(segment).filter((n) => n > 0);
      if (!found.length) {
        if (REDUCED.test(segment)) reducedSoFar = true;
        continue;
      }
      const isReduced = REDUCED.test(segment)
        ? true
        : STANDARD.test(segment)
          ? false
          : reducedSoFar;
      if (isReduced) {
        reducedSoFar = true;
        reduced.push(...found);
      } else {
        standard.push(...found);
      }
    }

    const band = standard.length ? standard : reduced;
    pricing.from = Math.min(...band);
    const top = Math.max(...band);
    pricing.to = top > pricing.from ? top : null;
    if (standard.length && reduced.length) {
      pricing.concession = Math.min(...reduced);
      const highest = Math.max(...reduced);
      // More than one reduced rate means the cheapest is a floor, and the
      // label has to say "from" rather than name a price nobody may pay.
      pricing.concessionTo = highest > pricing.concession ? highest : null;
    }
    return pricing;
  }

  /** Two readings of the same show — a listing page and a ticketing API —
      combined without either overwriting the other's better answer. */
  function mergePricing(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return {
      from: a.from ?? b.from,
      to: a.to ?? b.to,
      concession: a.concession ?? b.concession,
      concessionTo: a.concession != null ? a.concessionTo : b.concessionTo,
      free: a.free || b.free,
      payWhatYouLike: a.payWhatYouLike || b.payWhatYouLike,
      live: a.live || b.live || false,
      text: a.text || b.text,
      notes: a.notes || b.notes || null,
    };
  }

  /**
   * The cheapest ticket a venue-wide scheme puts within reach, for shows that
   * publish no concession of their own. Only schemes marked as running across
   * the programme count: a Christmas-only offer is not a price to quote on
   * every card.
   */
  function schemeFloor(scheme) {
    if (!scheme || !Array.isArray(scheme.schemes)) return null;
    const prices = scheme.schemes
      .filter((s) => s.broad && typeof s.price === "number")
      .map((s) => s.price);
    return prices.length ? Math.min(...prices) : null;
  }

  /**
   * One line for a card or a bar: "From £18 (conc. from £5)".
   *
   * A concession the show itself published is quoted as its own price. One
   * borrowed from a venue-wide pass is always "from", because it is a floor
   * across the programme rather than this production's own number, and the
   * show page names the pass that carries it.
   */
  function priceLabel(pricing, scheme) {
    if (!pricing) return null;
    if (pricing.free) return "Free";
    if (pricing.from == null) return pricing.payWhatYouLike ? "Pay what you like" : null;

    const floor = schemeFloor(scheme);
    const borrowed = pricing.concession == null && floor != null && floor < pricing.from;
    const concession = pricing.concession ?? (borrowed ? floor : null);
    const spread = pricing.to != null && pricing.to > pricing.from;

    let label = (spread ? "From " : "") + money(pricing.from);
    if (pricing.payWhatYouLike) label += " suggested";
    // "from" whenever the figure is a floor: a pass that spans the programme,
    // or one of several reduced rates this show publishes.
    const conceded = borrowed || pricing.concessionTo != null;
    if (concession != null)
      label += ` (conc. ${conceded ? "from " : ""}${money(concession)})`;
    return label;
  }

  /** Where a concession figure came from, so a page can say whose scheme it is. */
  function concessionSource(pricing, scheme) {
    if (!pricing || pricing.free || pricing.concession != null) return null;
    const floor = schemeFloor(scheme);
    if (floor == null || pricing.from == null || floor >= pricing.from) return null;
    const named = scheme.schemes.filter((s) => s.broad && s.price === floor);
    return { price: floor, schemes: named.map((s) => s.name) };
  }

  const HHMM = /^\d{2}:\d{2}$/;

  /** Distinct curtain times across a run, earliest first. */
  function distinctTimes(performances) {
    const times = new Set(
      (performances || []).map((p) => p && p.time).filter((t) => HHMM.test(String(t))),
    );
    return [...times].sort();
  }

  /**
   * The curtain time a card can print. One time is the time; two are both
   * worth naming; beyond that the evening performance leads and the rest are
   * matinees, with the full schedule a click away on the show page.
   */
  function timesLabel(performances, fallback) {
    const times = distinctTimes(performances);
    if (!times.length) return HHMM.test(String(fallback || "")) ? clockTime(fallback) : null;
    if (times.length === 1) return clockTime(times[0]);
    if (times.length === 2) return `${clockTime(times[0])} & ${clockTime(times[1])}`;
    const evenings = times.filter((t) => t >= "17:00");
    const daytime = times.filter((t) => t < "17:00");
    if (evenings.length && daytime.length) {
      // Whichever evening time the run actually uses most, not just the latest.
      const counts = {};
      for (const p of performances) if (p && evenings.includes(p.time)) counts[p.time] = (counts[p.time] || 0) + 1;
      const main = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))[0] || evenings[0];
      return `${clockTime(main)} & matinees`;
    }
    return "Times vary";
  }

  /** The time to store on the listing itself: whichever one the run uses most. */
  function headlineTime(performances) {
    const counts = {};
    for (const p of performances || [])
      if (HHMM.test(String(p && p.time))) counts[p.time] = (counts[p.time] || 0) + 1;
    const times = Object.keys(counts);
    if (!times.length) return null;
    return times.sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))[0];
  }

  /** "2 hours 35 minutes", "Approx 2 hours 50 minutes (including interval)"
      and a bare number of minutes all come back as minutes. */
  function readDuration(value) {
    if (typeof value === "number" && value > 0) return Math.round(value);
    const text = String(value || "");
    if (!text) return null;
    const hours = Number((text.match(/(\d+)\s*(?:hours?|hrs?|h)\b/i) || [])[1] || 0);
    const minutes = Number((text.match(/(\d+)\s*(?:minutes?|mins?|m)\b/i) || [])[1] || 0);
    const total = hours * 60 + minutes;
    return total > 0 ? total : null;
  }

  const durationLabel = (minutes) => {
    if (!minutes) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || null;
  };

  const api = {
    money,
    clockTime,
    readPricing,
    mergePricing,
    priceLabel,
    schemeFloor,
    concessionSource,
    distinctTimes,
    timesLabel,
    headlineTime,
    readDuration,
    durationLabel,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.Tickets = api;
})(typeof window !== "undefined" ? window : globalThis);
