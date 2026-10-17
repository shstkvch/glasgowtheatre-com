/**
 * Filtered queries for the public API.
 *
 * Static snapshots live under /api/v1/*.json and are served straight from the
 * build output. This Function handles the two extensionless list routes, which
 * need query parameters:
 *
 *   GET /api/v1/shows
 *   GET /api/v1/venues/{id}/shows
 *
 * Everything else falls through to the static asset, so a plain request for
 * /api/v1/shows.json never pays for a Function invocation.
 */
import core from "../../_lib/api-core.js";

const {
  API_VERSION,
  SITE,
  ApiError,
  parseQuery,
  filterShows,
  listEnvelope,
  showsToText,
} = core;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "ETag, X-Total-Count, X-Generated-At",
  "X-Content-Type-Options": "nosniff",
};

let cached = null;

async function dataset(env, request) {
  if (cached) return cached;
  const url = new URL("/api/v1/dataset.json", request.url);
  const response = await env.ASSETS.fetch(
    new Request(url.toString(), {
      headers: { Accept: "application/json" },
    }),
  );
  if (!response.ok) {
    throw new Error(`Dataset unavailable (${response.status})`);
  }
  cached = await response.json();
  return cached;
}

function etag(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `"v${API_VERSION}-${(hash >>> 0).toString(16)}"`;
}

function problem(status, title, detail, instance) {
  return new Response(
    JSON.stringify({
      type: `${SITE}/api/errors/${title.toLowerCase().replace(/\s+/g, "-")}`,
      title,
      status,
      detail,
      instance,
    }),
    {
      status,
      headers: {
        ...CORS,
        "Content-Type": "application/problem+json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function responseHeaders(dataset, tag, contentType) {
  return {
    ...CORS,
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    "X-Generated-At": dataset.generatedAt,
    ETag: tag,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const venueShows = path.match(/^\/api\/v1\/venues\/([^/]+)\/shows$/);

  if (path !== "/api/v1/shows" && !venueShows) {
    return env.ASSETS.fetch(request);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS, Allow: "GET, HEAD, OPTIONS" },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problem(405, "Method not allowed", `${request.method} is not supported`, url.pathname);
  }

  try {
    const data = await dataset(env, request);
    const params = parseQuery(url.searchParams);
    if (venueShows) {
      const id = decodeURIComponent(venueShows[1]);
      const venue = data.venues.find((entry) => entry.id === id);
      if (!venue) {
        return problem(404, "Not found", `No venue with id '${id}'`, url.pathname);
      }
      params.venue = new Set([id]);
    }
    const result = filterShows(data.shows, params);
    const tag = etag(
      `${data.generatedAt}:${url.pathname}:${url.searchParams.toString()}`,
    );
    if (request.headers.get("If-None-Match") === tag) {
      return new Response(null, {
        status: 304,
        headers: responseHeaders(data, tag, "application/json; charset=utf-8"),
      });
    }
    const body =
      params.format === "txt"
        ? showsToText(result.shows)
        : JSON.stringify(
            listEnvelope(result, {
              dataset: data,
              params,
              basePath: path,
            }),
            null,
            2,
          ) + "\n";
    const headers = responseHeaders(
      data,
      tag,
      params.format === "txt"
        ? "text/plain; charset=utf-8"
        : "application/json; charset=utf-8",
    );
    headers["X-Total-Count"] = String(result.total);
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return problem(error.status, error.title, error.detail, url.pathname + url.search);
    }
    console.error("api query failed", error);
    return problem(
      503,
      "Service unavailable",
      "The listings snapshot could not be read. Try again shortly.",
      url.pathname + url.search,
    );
  }
}
