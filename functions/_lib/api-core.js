/**
 * The public API's data model, shared by the build (which writes the static
 * snapshots) and the Pages Function (which answers filtered queries).
 *
 * Keep this file free of Node and Workers APIs: it is loaded by both.
 */
"use strict";

const API_VERSION = "1";
const SITE = "https://glasgowtheatre.com";
const API_ROOT = `${SITE}/api/v1`;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class ApiError extends Error {
  constructor(status, title, detail) {
    super(detail);
    this.status = status;
    this.title = title;
    this.detail = detail;
  }
}

const absolute = (url) => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE}${url.startsWith("/") ? "" : "/"}${url}`;
};

const isoDate = (value) => {
  if (!DATE_RE.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

/**
 * Turn an internal listing into the stable public shape. Nothing from the
 * scraper that describes how the data was obtained belongs here; consumers
 * should not have to learn our pipeline.
 */
function publicShow(event, venuesById) {
  const venue = venuesById.get(event.venueId) || {
    id: event.venueId,
    name: event.venue,
    area: null,
  };
  const pricing = event.pricing
    ? {
        currency: "GBP",
        from: event.pricing.from ?? null,
        to: event.pricing.to ?? null,
        concessionFrom: event.pricing.concession ?? null,
        concessionTo: event.pricing.concessionTo ?? null,
        free: Boolean(event.pricing.free),
        payWhatYouLike: Boolean(event.pricing.payWhatYouLike),
        text: event.pricing.text || null,
        source:
          event.pricing.read === "source"
            ? "venue-feed"
            : event.pricing.read === "model"
              ? "published-text"
              : "unknown",
        checkedAt: event.checkedAt || null,
      }
    : null;
  const performances = (event.performances || [])
    .map((performance) => ({
      date: performance.date,
      time: performance.time || null,
      ...(performance.accessibility
        ? { accessibility: performance.accessibility }
        : {}),
      ...(performance.price != null ? { price: performance.price } : {}),
      ...(performance.url ? { bookingUrl: performance.url } : {}),
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        String(a.time || "").localeCompare(String(b.time || "")),
    );
  return {
    id: event.id,
    url: `${SITE}/shows/${event.id}.html`,
    title: event.title,
    artForm: event.form,
    tags: [...(event.tags || [])],
    producer: event.producer || null,
    description: event.description || null,
    venue: {
      id: venue.id,
      name: venue.name,
      area: venue.area || null,
    },
    run: {
      opens: event.date,
      closes: event.endDate || event.date,
      time: event.time || null,
    },
    schedule: event.scheduleText ? { text: event.scheduleText } : null,
    performances,
    pricing,
    accessibility: event.accessibility || null,
    durationMinutes: event.duration ?? null,
    image: event.image
      ? {
          url: absolute(event.image),
          alt: event.imageAlt || event.title,
          credit: event.imageCredit || null,
        }
      : null,
    bookingUrl: event.ticketUrl || null,
    updatedAt: event.checkedAt || null,
  };
}

function publicVenue(venue, shows, concessions) {
  const upcoming = shows.filter((show) => show.venue.id === venue.id);
  const concession = concessions[venue.id] || null;
  return {
    id: venue.id,
    name: venue.name,
    area: venue.area || null,
    description: venue.description || null,
    website: venue.website || null,
    instagram: venue.instagram || null,
    programme: venue.mixedProgramme ? "mixed" : "theatre",
    url: `${SITE}/venues/${venue.id}.html`,
    upcomingShows: upcoming.length,
    showsUrl: `${API_ROOT}/venues/${venue.id}/shows.json`,
    concessions: concession
      ? {
          url: concession.url || null,
          checkedAt: concession.checkedAt || null,
          summary: concession.summary || null,
          schemes: concession.schemes || [],
          offers: concession.offers || [],
          fees: concession.fees || null,
        }
      : null,
  };
}

function countValues(shows, key) {
  const counts = {};
  for (const show of shows) {
    const value = key(show);
    if (value) counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

/** The whole public dataset, as one object. */
function buildDataset({ events, venues, concessions, status, generatedAt }) {
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  const shows = events
    .map((event) => publicShow(event, venuesById))
    .sort(
      (a, b) =>
        a.run.opens.localeCompare(b.run.opens) ||
        a.title.localeCompare(b.title),
    );
  const publicVenues = venues
    .map((venue) => publicVenue(venue, shows, concessions))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    apiVersion: API_VERSION,
    generatedAt,
    refreshedAt: (status && status.refreshedAt) || null,
    site: SITE,
    counts: {
      shows: shows.length,
      venues: publicVenues.length,
      venuesWithShows: publicVenues.filter((venue) => venue.upcomingShows > 0)
        .length,
      artForms: countValues(shows, (show) => show.artForm),
    },
    shows,
    venues: publicVenues,
  };
}

const readSet = (params, name) => {
  const values = params
    .getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? new Set(values) : null;
};

const readBoolean = (params, name) => {
  if (!params.has(name)) return null;
  const value = String(params.get(name)).toLowerCase();
  if (["1", "true", "yes"].includes(value)) return true;
  if (["0", "false", "no"].includes(value)) return false;
  throw new ApiError(
    400,
    "Invalid parameter",
    `'${name}' must be true or false`,
  );
};

const readInteger = (params, name, fallback) => {
  if (!params.has(name)) return fallback;
  const value = params.get(name);
  if (!/^\d+$/.test(value)) {
    throw new ApiError(
      400,
      "Invalid parameter",
      `'${name}' must be a whole number`,
    );
  }
  return Number(value);
};

const readNumber = (params, name) => {
  if (!params.has(name)) return null;
  const value = Number(params.get(name));
  if (!Number.isFinite(value) || value < 0) {
    throw new ApiError(
      400,
      "Invalid parameter",
      `'${name}' must be a non-negative number`,
    );
  }
  return value;
};

function readDate(params, name) {
  if (!params.has(name)) return null;
  const value = params.get(name);
  if (!isoDate(value)) {
    throw new ApiError(
      400,
      "Invalid parameter",
      `'${name}' must be a real date in YYYY-MM-DD form`,
    );
  }
  return value;
}

/** Parse and validate a list query. Unknown parameters are ignored so a
    future version can add one without breaking older clients. */
function parseQuery(params) {
  const date = readDate(params, "date");
  const from = readDate(params, "from");
  const to = readDate(params, "to");
  if (date && (from || to)) {
    throw new ApiError(
      400,
      "Invalid parameter",
      "'date' cannot be combined with 'from' or 'to'",
    );
  }
  if (from && to && from > to) {
    throw new ApiError(
      400,
      "Invalid parameter",
      "'from' must be on or before 'to'",
    );
  }
  const limit = readInteger(params, "limit", DEFAULT_LIMIT);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new ApiError(
      400,
      "Invalid parameter",
      `'limit' must be between 1 and ${MAX_LIMIT}`,
    );
  }
  const offset = readInteger(params, "offset", 0);
  const sort = (params.get("sort") || "date").toLowerCase();
  if (!["date", "closes", "title", "venue", "price"].includes(sort)) {
    throw new ApiError(
      400,
      "Invalid parameter",
      "'sort' must be date, closes, title, venue or price",
    );
  }
  const order = (params.get("order") || "asc").toLowerCase();
  if (!["asc", "desc"].includes(order)) {
    throw new ApiError(
      400,
      "Invalid parameter",
      "'order' must be asc or desc",
    );
  }
  const format = (params.get("format") || "json").toLowerCase();
  if (!["json", "txt"].includes(format)) {
    throw new ApiError(
      400,
      "Invalid parameter",
      "'format' must be json or txt",
    );
  }
  return {
    date: date || null,
    from: date || from,
    to: date || to,
    venue: readSet(params, "venue"),
    form: readSet(params, "form"),
    tag: readSet(params, "tag"),
    query: (params.get("q") || "").trim().toLocaleLowerCase(),
    free: readBoolean(params, "free"),
    payWhatYouLike: readBoolean(params, "payWhatYouLike"),
    hasPerformances: readBoolean(params, "hasPerformances"),
    minPrice: readNumber(params, "minPrice"),
    maxPrice: readNumber(params, "maxPrice"),
    sort,
    order,
    limit,
    offset,
    format,
  };
}

const matches = (show, params) => {
  if (params.from && show.run.closes < params.from) return false;
  if (params.to && show.run.opens > params.to) return false;
  if (params.venue && !params.venue.has(show.venue.id)) return false;
  if (params.form && !params.form.has(show.artForm)) return false;
  if (params.tag && !show.tags.some((tag) => params.tag.has(tag))) return false;
  if (params.free != null) {
    const free = Boolean(show.pricing && (show.pricing.free || show.pricing.from === 0));
    if (free !== params.free) return false;
  }
  if (params.payWhatYouLike != null) {
    const payWhatYouLike = Boolean(
      show.pricing && show.pricing.payWhatYouLike,
    );
    if (payWhatYouLike !== params.payWhatYouLike) return false;
  }
  if (params.hasPerformances != null) {
    const has = show.performances.length > 0;
    if (has !== params.hasPerformances) return false;
  }
  if (params.minPrice != null) {
    if (show.pricing?.from == null || show.pricing.from < params.minPrice)
      return false;
  }
  if (params.maxPrice != null) {
    if (show.pricing?.from == null || show.pricing.from > params.maxPrice)
      return false;
  }
  if (params.query) {
    const haystack = [
      show.title,
      show.venue.name,
      show.venue.area,
      show.description,
      show.producer,
      show.artForm,
      ...show.tags,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    if (!haystack.includes(params.query)) return false;
  }
  return true;
};

const compare = (a, b, sort) => {
  switch (sort) {
    case "title":
      return a.title.localeCompare(b.title);
    case "venue":
      return (
        a.venue.name.localeCompare(b.venue.name) ||
        a.run.opens.localeCompare(b.run.opens) ||
        a.title.localeCompare(b.title)
      );
    case "price":
      return (
        (a.pricing?.from ?? Number.POSITIVE_INFINITY) -
          (b.pricing?.from ?? Number.POSITIVE_INFINITY) ||
        a.run.opens.localeCompare(b.run.opens) ||
        a.title.localeCompare(b.title)
      );
    case "closes":
      return (
        a.run.closes.localeCompare(b.run.closes) ||
        a.run.opens.localeCompare(b.run.opens) ||
        a.title.localeCompare(b.title)
      );
    default:
      return (
        a.run.opens.localeCompare(b.run.opens) ||
        a.title.localeCompare(b.title)
      );
  }
};

function filterShows(shows, params) {
  const matched = shows
    .filter((show) => matches(show, params))
    .sort((a, b) => {
      const result = compare(a, b, params.sort);
      return params.order === "desc" ? -result : result;
    });
  const page = matched.slice(params.offset, params.offset + params.limit);
  return {
    shows: page,
    total: matched.length,
    limit: params.limit,
    offset: params.offset,
  };
}

function queryString(params, offset, { includeFormat = true } = {}) {
  const query = new URLSearchParams();
  if (params.date) query.set("date", params.date);
  if (params.from && !params.date) query.set("from", params.from);
  if (params.to && !params.date) query.set("to", params.to);
  for (const [name, set] of [
    ["venue", params.venue],
    ["form", params.form],
    ["tag", params.tag],
  ]) {
    if (set) for (const value of set) query.append(name, value);
  }
  if (params.query) query.set("q", params.query);
  for (const name of ["free", "payWhatYouLike", "hasPerformances"]) {
    if (params[name] != null) query.set(name, String(params[name]));
  }
  if (params.minPrice != null) query.set("minPrice", String(params.minPrice));
  if (params.maxPrice != null) query.set("maxPrice", String(params.maxPrice));
  if (params.sort !== "date") query.set("sort", params.sort);
  if (params.order !== "asc") query.set("order", params.order);
  if (includeFormat && params.format !== "json") query.set("format", params.format);
  query.set("limit", String(params.limit));
  query.set("offset", String(offset));
  return query.toString();
}

function listEnvelope(result, { dataset, params, basePath }) {
  const { shows, total, limit, offset } = result;
  const nextOffset = offset + limit;
  const prevOffset = Math.max(0, offset - limit);
  const next =
    nextOffset < total
      ? `${SITE}${basePath}?${queryString(params, nextOffset)}`
      : null;
  const prev =
    offset > 0
      ? `${SITE}${basePath}?${queryString(params, prevOffset)}`
      : null;
  return {
    apiVersion: API_VERSION,
    generatedAt: dataset.generatedAt,
    refreshedAt: dataset.refreshedAt,
    total,
    count: shows.length,
    limit,
    offset,
    next,
    prev,
    shows,
  };
}

const textField = (value) =>
  String(value ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .trim();

/** A deliberately boring tab-separated view, for shell scripts and for
    languages where pulling in a JSON parser would obscure the example. */
function showsToText(shows) {
  const lines = [
    "# opens\tcloses\ttitle\tvenue\tartForm\tfromPrice\turl",
    ...shows.map((show) =>
      [
        show.run.opens,
        show.run.closes,
        textField(show.title),
        textField(show.venue.name),
        textField(show.artForm),
        show.pricing?.from ?? "",
        show.url,
      ].join("\t"),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

module.exports = {
  API_VERSION,
  SITE,
  API_ROOT,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  ApiError,
  absolute,
  isoDate,
  publicShow,
  publicVenue,
  buildDataset,
  parseQuery,
  filterShows,
  listEnvelope,
  showsToText,
  queryString,
};
