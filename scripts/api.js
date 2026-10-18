/**
 * Build the public, versioned API from the same merged listings the site
 * publishes. Everything here is a file written into dist/; the filtered
 * query layer is a Pages Function in functions/api/v1.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  API_VERSION,
  SITE,
  API_ROOT,
  buildDataset,
  showsToText,
} = require("./api-core");

const ROOT = path.join(__dirname, "..");
const EXAMPLES = [
  {
    key: "javascript",
    label: "JavaScript",
    runtime: "Node.js 22",
    id: 102,
    stdin: "json",
    file: "javascript/shows.js",
  },
  {
    key: "python",
    label: "Python",
    runtime: "3.12",
    id: 100,
    stdin: "json",
    file: "python/shows.py",
  },
  {
    key: "php",
    label: "PHP",
    runtime: "8.3",
    id: 98,
    stdin: "json",
    file: "php/shows.php",
  },
  {
    key: "c",
    label: "C",
    runtime: "Clang 18",
    id: 104,
    stdin: "txt",
    file: "c/shows.c",
  },
  {
    key: "go",
    label: "Go",
    runtime: "1.22",
    id: 106,
    stdin: "json",
    file: "go/main.go",
  },
];

function loadExamples() {
  return EXAMPLES.map((example) => {
    const source = fs.readFileSync(
      path.join(ROOT, "examples", example.file),
      "utf8",
    );
    return { ...example, source };
  });
}

const pretty = (value) => JSON.stringify(value, null, 2) + "\n";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
const jsonForScript = (value) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const staticList = (dataset, shows) => ({
  apiVersion: API_VERSION,
  generatedAt: dataset.generatedAt,
  refreshedAt: dataset.refreshedAt,
  total: shows.length,
  count: shows.length,
  limit: null,
  offset: 0,
  next: null,
  prev: null,
  shows,
});

const dateSchema = {
  type: "string",
  format: "date",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: "A calendar date in Europe/London, with no time zone offset.",
};

const pricingSchema = {
  type: ["object", "null"],
  description:
    "The venue's published price. `from` may be the cheapest seat still on sale, not the face value; `text` is the venue's own wording.",
  required: ["currency", "from", "free", "payWhatYouLike", "text", "source", "checkedAt"],
  properties: {
    currency: { const: "GBP" },
    from: { type: ["number", "null"] },
    to: { type: ["number", "null"] },
    concessionFrom: { type: ["number", "null"] },
    concessionTo: { type: ["number", "null"] },
    free: { type: "boolean" },
    payWhatYouLike: { type: "boolean" },
    text: { type: ["string", "null"] },
    source: {
      type: "string",
      enum: ["venue-feed", "published-text", "unknown"],
      description:
        "How the number was obtained, not whether it is live. `venue-feed` came from structured venue data; `published-text` was read from the venue's prose.",
    },
    checkedAt: { type: ["string", "null"], format: "date" },
  },
};

const performanceSchema = {
  type: "object",
  required: ["date", "time"],
  properties: {
    date: dateSchema,
    time: {
      type: ["string", "null"],
      pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
      description: "24-hour local time, or null when the venue has not confirmed one.",
    },
    accessibility: { type: "string" },
    price: { type: "number" },
    bookingUrl: { type: "string", format: "uri" },
  },
};

const showSchema = {
  type: "object",
  required: [
    "id",
    "url",
    "title",
    "artForm",
    "tags",
    "producer",
    "description",
    "venue",
    "run",
    "schedule",
    "performances",
    "pricing",
    "accessibility",
    "durationMinutes",
    "image",
    "bookingUrl",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", description: "Stable identifier, also used by the site's show page." },
    url: { type: "string", format: "uri" },
    title: { type: "string" },
    artForm: {
      type: "string",
      description: "Exactly one art form, from the site's published vocabulary.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Includes searchable structural tags such as lunchtime or scratch.",
    },
    producer: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    venue: {
      type: "object",
      required: ["id", "name", "area"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        area: { type: ["string", "null"] },
      },
    },
    run: {
      type: "object",
      required: ["opens", "closes", "time"],
      properties: {
        opens: dateSchema,
        closes: dateSchema,
        time: {
          type: ["string", "null"],
          pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
        },
      },
    },
    schedule: {
      type: ["object", "null"],
      properties: { text: { type: "string" } },
    },
    performances: { type: "array", items: performanceSchema },
    pricing: pricingSchema,
    accessibility: { type: ["string", "null"] },
    durationMinutes: { type: ["integer", "null"] },
    image: {
      type: ["object", "null"],
      required: ["url", "alt", "credit"],
      properties: {
        url: { type: "string", format: "uri" },
        alt: { type: "string" },
        credit: { type: ["string", "null"] },
      },
    },
    bookingUrl: { type: ["string", "null"], format: "uri" },
    updatedAt: { type: ["string", "null"], format: "date" },
  },
};

const venueSchema = {
  type: "object",
  required: [
    "id",
    "name",
    "area",
    "colour",
    "ink",
    "description",
    "website",
    "instagram",
    "programme",
    "url",
    "upcomingShows",
    "showsUrl",
    "concessions",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    area: { type: ["string", "null"] },
    colour: {
      type: "string",
      pattern: "^#[0-9a-f]{6}$",
      description:
        "The venue's house colour, adjusted to clear WCAG AA against ink.",
    },
    ink: {
      type: "string",
      pattern: "^#[0-9a-f]{6}$",
      description: "The legible text colour to use on colour.",
    },
    description: { type: ["string", "null"] },
    website: { type: ["string", "null"], format: "uri" },
    instagram: { type: ["string", "null"] },
    programme: { type: "string", enum: ["theatre", "mixed"] },
    url: { type: "string", format: "uri" },
    upcomingShows: { type: "integer" },
    showsUrl: { type: "string", format: "uri" },
    concessions: {
      type: ["object", "null"],
      properties: {
        url: { type: ["string", "null"], format: "uri" },
        checkedAt: { type: ["string", "null"], format: "date" },
        summary: { type: ["string", "null"] },
        schemes: { type: "array", items: { type: "object" } },
        offers: { type: "array", items: { type: "object" } },
        fees: { type: ["string", "null"] },
      },
    },
  },
};

const showListSchema = {
  type: "object",
  required: [
    "apiVersion",
    "generatedAt",
    "refreshedAt",
    "total",
    "count",
    "limit",
    "offset",
    "next",
    "prev",
    "shows",
  ],
  properties: {
    apiVersion: { const: API_VERSION },
    generatedAt: { type: "string", format: "date-time" },
    refreshedAt: { type: ["string", "null"], format: "date-time" },
    total: { type: "integer" },
    count: { type: "integer" },
    limit: { type: ["integer", "null"] },
    offset: { type: "integer" },
    next: { type: ["string", "null"], format: "uri" },
    prev: { type: ["string", "null"], format: "uri" },
    shows: { type: "array", items: showSchema },
  },
};

const showResponseSchema = {
  type: "object",
  required: ["apiVersion", "generatedAt", "refreshedAt", "show"],
  properties: {
    apiVersion: { const: API_VERSION },
    generatedAt: { type: "string", format: "date-time" },
    refreshedAt: { type: ["string", "null"], format: "date-time" },
    show: showSchema,
  },
};

const venueResponseSchema = {
  type: "object",
  required: ["apiVersion", "generatedAt", "refreshedAt", "venue"],
  properties: {
    apiVersion: { const: API_VERSION },
    generatedAt: { type: "string", format: "date-time" },
    refreshedAt: { type: ["string", "null"], format: "date-time" },
    venue: venueSchema,
  },
};

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${API_ROOT}/schema.json`,
  title: "Glasgow Theatre API",
  description:
    "Read-only listings for theatre, dance and performance in Glasgow. Dates are Europe/London calendar dates; prices are a guide, not a quote.",
  $defs: {
    Show: showSchema,
    Venue: venueSchema,
    ShowList: showListSchema,
    VenueList: {
      type: "object",
      properties: {
        apiVersion: { const: API_VERSION },
        generatedAt: { type: "string", format: "date-time" },
        refreshedAt: { type: ["string", "null"], format: "date-time" },
        total: { type: "integer" },
        count: { type: "integer" },
        venues: { type: "array", items: { $ref: "#/$defs/Venue" } },
      },
    },
    Problem: {
      type: "object",
      properties: {
        type: { type: "string", format: "uri" },
        title: { type: "string" },
        status: { type: "integer" },
        detail: { type: "string" },
        instance: { type: "string" },
      },
    },
  },
};

const queryParameters = [
  {
    name: "from",
    in: "query",
    schema: { type: "string", format: "date" },
    description: "Match runs that have not closed before this date.",
  },
  {
    name: "to",
    in: "query",
    schema: { type: "string", format: "date" },
    description: "Match runs that open on or before this date.",
  },
  {
    name: "date",
    in: "query",
    schema: { type: "string", format: "date" },
    description: "A single day. Shorthand for from=date&to=date; cannot be combined with either.",
  },
  {
    name: "venue",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description: "Venue id. Repeat the parameter or comma-separate values.",
  },
  {
    name: "form",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description: "Art form, such as play, musical, dance or stand-up.",
  },
  {
    name: "tag",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description: "Any tag, including structural tags such as lunchtime.",
  },
  {
    name: "q",
    in: "query",
    schema: { type: "string" },
    description: "Case-insensitive search over title, venue, description, producer, art form and tags.",
  },
  {
    name: "free",
    in: "query",
    schema: { type: "boolean" },
    description: "Only shows whose published price is free.",
  },
  {
    name: "payWhatYouLike",
    in: "query",
    schema: { type: "boolean" },
    description: "Only shows with a pay-what-you-like price.",
  },
  {
    name: "hasPerformances",
    in: "query",
    schema: { type: "boolean" },
    description: "Only shows with at least one listed performance.",
  },
  {
    name: "minPrice",
    in: "query",
    schema: { type: "number", minimum: 0 },
    description: "Only shows whose known from-price is at least this amount.",
  },
  {
    name: "maxPrice",
    in: "query",
    schema: { type: "number", minimum: 0 },
    description: "Only shows whose known from-price is at most this amount.",
  },
  {
    name: "sort",
    in: "query",
    schema: { type: "string", enum: ["date", "closes", "title", "venue", "price"], default: "date" },
  },
  {
    name: "order",
    in: "query",
    schema: { type: "string", enum: ["asc", "desc"], default: "asc" },
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
  {
    name: "offset",
    in: "query",
    schema: { type: "integer", minimum: 0, default: 0 },
  },
  {
    name: "format",
    in: "query",
    schema: { type: "string", enum: ["json", "txt"], default: "json" },
    description: "Use txt for a tab-separated table suitable for shell scripts and C.",
  },
];

const jsonResponse = (description, schemaRef) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schemaRef}` },
    },
  },
});

const problemResponse = (description) => ({
  description,
  content: {
    "application/problem+json": {
      schema: { $ref: "#/components/schemas/Problem" },
    },
  },
});

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Glasgow Theatre API",
    version: API_VERSION,
    description:
      "Read-only listings for theatre, dance and performance in Glasgow. Free to use with attribution to Glasgow Theatre. Dates are Europe/London calendar dates; prices and times are a guide, so always confirm with the venue.",
    license: { name: "Free to use with attribution" },
  },
  servers: [{ url: API_ROOT }],
  tags: [
    { name: "Shows" },
    { name: "Venues" },
    { name: "Meta" },
  ],
  paths: {
    "/shows": {
      get: {
        tags: ["Shows"],
        summary: "List shows",
        description:
          "Filtered, paginated list. The static snapshot at /shows.json returns everything in one response.",
        parameters: queryParameters,
        responses: {
          200: {
            description: "A page of shows, or a tab-separated table when format=txt.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShowList" },
              },
              "text/plain": {
                schema: { type: "string" },
              },
            },
          },
          400: problemResponse("Invalid query parameter"),
        },
      },
    },
    "/shows.json": {
      get: {
        tags: ["Shows"],
        summary: "Every upcoming show",
        responses: { 200: jsonResponse("All upcoming shows", "ShowList") },
      },
    },
    "/shows/{id}.json": {
      get: {
        tags: ["Shows"],
        summary: "One show",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: jsonResponse("A show", "ShowResponse"),
          404: problemResponse("No show with that id"),
        },
      },
    },
    "/venues": {
      get: {
        tags: ["Venues"],
        summary: "List venues",
        responses: { 200: jsonResponse("All venues", "VenueList") },
      },
    },
    "/venues.json": {
      get: {
        tags: ["Venues"],
        summary: "Every venue",
        responses: { 200: jsonResponse("All venues", "VenueList") },
      },
    },
    "/venues/{id}.json": {
      get: {
        tags: ["Venues"],
        summary: "One venue",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: jsonResponse("A venue", "VenueResponse"),
          404: problemResponse("No venue with that id"),
        },
      },
    },
    "/venues/{id}/shows": {
      get: {
        tags: ["Venues", "Shows"],
        summary: "Shows at one venue",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          ...queryParameters.filter((parameter) => parameter.name !== "venue"),
        ],
        responses: {
          200: jsonResponse("A page of that venue's shows", "ShowList"),
          404: problemResponse("No venue with that id"),
        },
      },
    },
    "/meta.json": {
      get: {
        tags: ["Meta"],
        summary: "Build provenance and counts",
        responses: { 200: jsonResponse("Dataset metadata", "Meta") },
      },
    },
  },
  components: {
    schemas: {
      Show: showSchema,
      Venue: venueSchema,
      ShowList: showListSchema,
      ShowResponse: showResponseSchema,
      VenueResponse: venueResponseSchema,
      VenueList: schema.$defs.VenueList,
      Problem: schema.$defs.Problem,
      Meta: {
        type: "object",
        properties: {
          apiVersion: { const: API_VERSION },
          generatedAt: { type: "string", format: "date-time" },
          refreshedAt: { type: ["string", "null"], format: "date-time" },
          counts: { type: "object" },
          endpoints: { type: "object" },
        },
      },
    },
  },
};

function buildApiFiles({
  events,
  venues,
  concessions,
  status,
  generatedAt = new Date().toISOString(),
}) {
  const dataset = buildDataset({ events, venues, concessions, status, generatedAt });
  const files = {};
  const meta = {
    apiVersion: API_VERSION,
    generatedAt: dataset.generatedAt,
    refreshedAt: dataset.refreshedAt,
    site: SITE,
    counts: dataset.counts,
    endpoints: {
      shows: `${API_ROOT}/shows`,
      showsSnapshot: `${API_ROOT}/shows.json`,
      showsText: `${API_ROOT}/shows.txt`,
      venues: `${API_ROOT}/venues.json`,
      preview: `${API_ROOT}/shows-preview.json`,
      openapi: `${API_ROOT}/openapi.json`,
      schema: `${API_ROOT}/schema.json`,
      documentation: `${SITE}/api/`,
      playground: `${SITE}/api/examples.html`,
    },
  };
  const preview = dataset.shows.slice(0, 5);

  files["api/v1/dataset.json"] = pretty(dataset);
  files["api/v1/meta.json"] = pretty(meta);
  files["api/v1/index.json"] = pretty({
    apiVersion: API_VERSION,
    generatedAt: dataset.generatedAt,
    documentation: `${SITE}/api/`,
    playground: `${SITE}/api/examples.html`,
    openapi: `${API_ROOT}/openapi.json`,
    schema: `${API_ROOT}/schema.json`,
    endpoints: meta.endpoints,
  });
  files["api/v1/shows.json"] = pretty(staticList(dataset, dataset.shows));
  files["api/v1/shows.txt"] = showsToText(dataset.shows);
  files["api/v1/shows-preview.json"] = pretty(staticList(dataset, preview));
  files["api/v1/shows-preview.txt"] = showsToText(preview);
  files["api/v1/venues.json"] = pretty({
    apiVersion: API_VERSION,
    generatedAt: dataset.generatedAt,
    refreshedAt: dataset.refreshedAt,
    total: dataset.venues.length,
    count: dataset.venues.length,
    venues: dataset.venues,
  });

  for (const show of dataset.shows) {
    files[`api/v1/shows/${show.id}.json`] = pretty({
      apiVersion: API_VERSION,
      generatedAt: dataset.generatedAt,
      refreshedAt: dataset.refreshedAt,
      show,
    });
  }
  for (const venue of dataset.venues) {
    const shows = dataset.shows.filter((show) => show.venue.id === venue.id);
    files[`api/v1/venues/${venue.id}.json`] = pretty({
      apiVersion: API_VERSION,
      generatedAt: dataset.generatedAt,
      refreshedAt: dataset.refreshedAt,
      venue,
    });
    files[`api/v1/venues/${venue.id}/shows.json`] = pretty(
      staticList(dataset, shows),
    );
    files[`api/v1/venues/${venue.id}/shows.txt`] = showsToText(shows);
  }

  files["api/v1/schema.json"] = pretty(schema);
  files["api/v1/openapi.json"] = pretty(openapi);
  files["_headers"] =
    "/api/*\n" +
    "  Access-Control-Allow-Origin: *\n" +
    "  Access-Control-Allow-Methods: GET, HEAD, OPTIONS\n" +
    "  Access-Control-Allow-Headers: Content-Type\n" +
    "  Access-Control-Max-Age: 86400\n" +
    "  Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400\n" +
    "  X-Content-Type-Options: nosniff\n";
  files["_routes.json"] = pretty({
    version: 1,
    include: ["/api/v1/shows", "/api/v1/venues/*/shows"],
    exclude: [],
  });

  return { files, dataset, meta };
}

function docsBody({ dataset, sampleShow, sampleVenue }) {
  const counts = dataset.counts;
  return `
<section class="page-hero container api-hero"><p class="eyebrow">For developers</p><h1>An API for<br>Glasgow’s stages.</h1><p>A free, read-only JSON API for every show and venue on Glasgow Theatre. No key, no account, no tracking. ${counts.shows} upcoming shows across ${counts.venuesWithShows} venues, refreshed with the site.</p><p class="api-hero-actions"><a class="btn" href="/api/examples.html">Try it in your browser ${"\u2197"}</a><a class="text-button" href="/api/v1/shows.json">Download the full feed ${"\u2197"}</a></p></section>
<section class="container api-docs">
  <div class="api-quick">
    <h2>Quick start</h2>
    <pre tabindex="0"><code>curl -s '${API_ROOT}/shows?venue=tron&amp;limit=3' | jq '.shows[] | {title, run, pricing}'</code></pre>
    <p>Browse <a href="${SITE}/api/">this page for the contract</a>, open the <a href="/api/examples.html">interactive examples</a>, or point a client at <a href="${API_ROOT}/openapi.json">OpenAPI</a>.</p>
  </div>

  <h2>Endpoints</h2>
  <div class="api-table-wrap"><table class="api-table">
    <thead><tr><th>Method</th><th>Path</th><th>What it returns</th></tr></thead>
    <tbody>
      <tr><td>GET</td><td><code>/api/v1/shows</code></td><td>Filtered, paginated shows</td></tr>
      <tr><td>GET</td><td><code>/api/v1/shows.json</code></td><td>Every upcoming show in one response</td></tr>
      <tr><td>GET</td><td><code>/api/v1/shows/{id}.json</code></td><td>One show, including every performance</td></tr>
      <tr><td>GET</td><td><code>/api/v1/shows.txt</code></td><td>Every show as tab-separated text</td></tr>
      <tr><td>GET</td><td><code>/api/v1/venues.json</code></td><td>Every venue, with concessions</td></tr>
      <tr><td>GET</td><td><code>/api/v1/venues/{id}.json</code></td><td>One venue</td></tr>
      <tr><td>GET</td><td><code>/api/v1/venues/{id}/shows</code></td><td>Shows at one venue; same filters as <code>/shows</code></td></tr>
      <tr><td>GET</td><td><code>/api/v1/meta.json</code></td><td>Build time, refresh time and counts</td></tr>
      <tr><td>GET</td><td><code>/api/v1/openapi.json</code></td><td>OpenAPI 3.1 description</td></tr>
      <tr><td>GET</td><td><code>/api/v1/schema.json</code></td><td>JSON Schema for every response</td></tr>
    </tbody>
  </table></div>

  <h2>Filtering</h2>
  <p>All parameters are optional. Repeat a parameter or comma-separate values to match any of them.</p>
  <div class="api-table-wrap"><table class="api-table api-params">
    <thead><tr><th>Parameter</th><th>Example</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td><code>from</code>, <code>to</code></td><td><code>?from=2026-10-01&amp;to=2026-10-31</code></td><td>Match overlapping runs, not just opening nights</td></tr>
      <tr><td><code>date</code></td><td><code>?date=2026-10-17</code></td><td>One day; shorthand for <code>from=to=date</code></td></tr>
      <tr><td><code>venue</code></td><td><code>?venue=tron,tramway</code></td><td>Venue ids from <code>/venues.json</code></td></tr>
      <tr><td><code>form</code></td><td><code>?form=play,musical</code></td><td>Art form, e.g. play, dance, stand-up</td></tr>
      <tr><td><code>tag</code></td><td><code>?tag=lunchtime</code></td><td>Any tag, including structural ones</td></tr>
      <tr><td><code>q</code></td><td><code>?q=macbeth</code></td><td>Search title, venue, description, producer, art form and tags</td></tr>
      <tr><td><code>free</code></td><td><code>?free=true</code></td><td>Free shows</td></tr>
      <tr><td><code>payWhatYouLike</code></td><td><code>?payWhatYouLike=true</code></td><td>Pay-what-you-like shows</td></tr>
      <tr><td><code>hasPerformances</code></td><td><code>?hasPerformances=true</code></td><td>Only shows with a performance list</td></tr>
      <tr><td><code>minPrice</code>, <code>maxPrice</code></td><td><code>?maxPrice=15</code></td><td>Filter on the published from-price</td></tr>
      <tr><td><code>sort</code>, <code>order</code></td><td><code>?sort=price&amp;order=asc</code></td><td>date (default), closes, title, venue, price</td></tr>
      <tr><td><code>limit</code>, <code>offset</code></td><td><code>?limit=20&amp;offset=20</code></td><td>Pagination; limit is 1–200, default 50</td></tr>
      <tr><td><code>format</code></td><td><code>?format=txt</code></td><td>Tab-separated text instead of JSON</td></tr>
    </tbody>
  </table></div>

  <h2>A show</h2>
  <p>Every response has the same top-level provenance fields, so a client can tell when the data was built and refreshed.</p>
  <pre tabindex="0"><code>${esc(JSON.stringify(sampleShow, null, 2))}</code></pre>

  <h2>A venue</h2>
  <p>Concessions are a property of the building, not the show. They are hand-checked against the venue's own page and the date is published with them. <code>colour</code> is the house colour used on the calendar, adjusted to clear WCAG AA against <code>ink</code>; use the pair together if you are drawing the venue yourself.</p>
  <pre tabindex="0"><code>${esc(JSON.stringify(sampleVenue, null, 2))}</code></pre>

  <h2>What the data means</h2>
  <ul>
    <li><strong>Dates are Europe/London calendar dates.</strong> There is no UTC offset on <code>run.opens</code>, <code>run.closes</code> or performance dates.</li>
    <li><strong>Only upcoming shows are published.</strong> The build drops expired listings, so an empty response means nothing is listed for that query.</li>
    <li><strong>Prices are a guide.</strong> <code>pricing.from</code> can be the cheapest seat still on sale, not the face value, especially at the King's, Theatre Royal and Pavilion. <code>pricing.text</code> is the venue's own wording; <code>pricing.source</code> says how it was read; <code>pricing.checkedAt</code> says when.</li>
    <li><strong>Not every show has performances.</strong> Where a venue publishes only a run, <code>performances</code> is empty and <code>run.time</code> may be the only time.</li>
    <li><strong>Accessibility is free text.</strong> It is not a structured guarantee; check the booking page.</li>
    <li><strong>Images remain the venue's copyright.</strong> Credit is included where we have it.</li>
    <li><strong>Attribution.</strong> Please credit Glasgow Theatre and link to <a href="${SITE}/">glasgowtheatre.com</a> when you use the data. Do not present it as official venue information.</li>
  </ul>

  <h2>Versioning</h2>
  <p>The path carries the major version: <code>/api/v1</code>. Minor versions are additive only, so a client written for <code>1.0</code> keeps working with <code>1.1</code>. A breaking change gets <code>/api/v2</code> and at least twelve months of overlap.</p>
  <h3>Changelog</h3>
  <ul><li><strong>v1.1, October 2026.</strong> Venue objects gained <code>colour</code> and <code>ink</code> for the calendar's house palette. Additive; <code>/api/v1</code> is unchanged.</li><li><strong>v1.0, October 2026.</strong> First public release: shows, venues, concessions, OpenAPI and JSON Schema.</li></ul>

  <h2>Static snapshots and CORS</h2>
  <p>The <code>.json</code> endpoints are files written by the daily build; they are cached at the edge and are the safest thing to poll. The extensionless <code>/shows</code> endpoint is a Cloudflare Pages Function that filters the same snapshot. All endpoints send <code>Access-Control-Allow-Origin: *</code>, so they can be called from a browser on any origin.</p>

  <h2>Need a language example?</h2>
  <p><a href="/api/examples.html">Open the interactive examples</a> for JavaScript, Python, PHP, C and Go. Each one is editable, runs in a sandbox, and is also available as a file in the repository under <code>examples/</code>.</p>
</section>`;
}

function playgroundBody({ examples, scriptUrl }) {
  const first = examples[0];
  return `
<section class="page-hero container api-hero"><p class="eyebrow">Try it</p><h1>Edit. Run.<br>See the data.</h1><p>The page fetches a live snapshot of five shows, then hands it to the program on standard input. Edit the code, press <strong>Run</strong>, and the output appears below. Nothing is saved.</p></section>
<section class="container api-playground">
  <div class="playground-bar">
    <div class="lang-tabs" role="group" aria-label="Example language">
      ${examples
        .map(
          (example, index) =>
            `<button class="lang-tab${index === 0 ? " active" : ""}" aria-pressed="${index === 0}" data-lang="${esc(example.key)}">${esc(example.label)}<span>${esc(example.runtime)}</span></button>`,
        )
        .join("")}
    </div>
    <div class="playground-actions">
      <button class="text-button" id="api-reset" type="button">Reset</button>
      <button class="btn" id="api-run" type="button">Run code ${"\u2197"}</button>
    </div>
  </div>
  <div class="code-editor-head"><span>Editor</span><span id="api-code-count" class="code-count"></span></div>
  <label class="visually-hidden" for="api-code">Example code</label>
  <textarea id="api-code" class="code-editor" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off">${esc(first.source)}</textarea>
  <p class="api-run-status" id="api-run-status" role="status" aria-live="polite">Ready. Uses ${esc(first.label)} ${esc(first.runtime)}.</p>
  <div class="code-output-wrap"><div class="code-output-head"><span>Output</span><button class="text-button" id="api-clear" type="button">Clear</button></div><pre class="code-output" id="api-output" tabindex="0">Press Run to see the result.</pre></div>
  <div class="api-notes">
    <p><strong>What runs where.</strong> This page sends your code to <a href="https://judge0.com" rel="noreferrer">Judge0's public sandbox</a>, a hosted execution service. The API snapshot itself is fetched from this site and passed in on stdin, so the sandbox never needs network access. Do not paste secrets into the editor.</p>
    <p><strong>Run it locally.</strong> The same programs live in the repository under <code>examples/</code>. Each reads the API response from stdin:</p>
    <pre tabindex="0"><code>curl -s '${API_ROOT}/shows-preview.json' | node examples/javascript/shows.js
curl -s '${API_ROOT}/shows-preview.json' | python3 examples/python/shows.py
cc -O2 -o /tmp/shows examples/c/shows.c
curl -s '${API_ROOT}/shows-preview.txt' | /tmp/shows</code></pre>
    <p>For C and shell scripts, use <code>?format=txt</code> or <code>/shows.txt</code> to avoid a JSON parser.</p>
  </div>
</section>
<script>window.API_EXAMPLES = ${jsonForScript(examples)};window.API_RUNNER = "https://ce.judge0.com/submissions?base64_encoded=true&wait=true";window.API_PREVIEW = "/api/v1/shows-preview";</script>
<script defer src="${scriptUrl}"></script>`;
}

module.exports = {
  EXAMPLES,
  loadExamples,
  buildApiFiles,
  docsBody,
  playgroundBody,
};
