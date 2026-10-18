const test = require("node:test");
const assert = require("node:assert");
const {
  ApiError,
  publicShow,
  buildDataset,
  parseQuery,
  filterShows,
  showsToText,
} = require("../scripts/api-core");
const { buildApiFiles } = require("../scripts/api");

const venues = [
  {
    id: "tramway",
    name: "Tramway",
    area: "Pollokshields",
    description: "A former tram depot.",
    website: "https://tramway.org",
    instagram: "tramwayart",
  },
  {
    id: "tron",
    name: "Tron Theatre",
    area: "Merchant City",
    description: "A converted church.",
    website: "https://tron.co.uk",
    mixedProgramme: true,
  },
];
const venuesById = new Map(venues.map((venue) => [venue.id, venue]));

const event = (overrides = {}) => ({
  id: "thrice-2026",
  title: "Thrice",
  venue: "Tramway",
  venueId: "tramway",
  date: "2026-10-16",
  endDate: "2026-10-17",
  time: "19:30",
  form: "dance",
  tags: ["dance"],
  description: "A response to Macbeth.",
  ticketUrl: "https://www.tramway.org/event/thrice/",
  image: "/images/thrice.webp",
  imageAlt: "The ensemble on a dark stage.",
  imageCredit: "Alberto Santos Bellido",
  checkedAt: "2026-10-15",
  sourceGenre: "Dance",
  type: "professional",
  scheduleRead: "model",
  pricing: {
    from: 18,
    to: 22,
    concession: 5,
    concessionTo: null,
    free: false,
    payWhatYouLike: false,
    text: "From £18 (conc. from £5)",
    read: "source",
  },
  performances: [
    { date: "2026-10-17", time: "19:30", accessibility: "BSL interpreted" },
    { date: "2026-10-16", time: "19:30", price: 18 },
  ],
  accessibility: "Sat 17 Oct, 7.30pm · BSL interpreted",
  duration: 75,
  scheduleText: "16–17 Oct, 7.30pm",
  ...overrides,
});

const datasetFor = (events = [event()]) =>
  buildDataset({
    events,
    venues,
    concessions: {
      tramway: {
        url: "https://tramway.org/access",
        checkedAt: "2026-10-15",
        summary: "Concessions at Tramway.",
        schemes: [{ name: "Student", price: 5 }],
        offers: [],
        fees: null,
      },
    },
    status: { refreshedAt: "2026-10-15T05:00:00.000Z" },
    generatedAt: "2026-10-15T05:20:00.000Z",
  });

test("the public show shape keeps the listing but drops the scrape pipeline", () => {
  const show = publicShow(event(), venuesById);
  assert.equal(show.id, "thrice-2026");
  assert.equal(show.url, "https://glasgowtheatre.com/shows/thrice-2026.html");
  assert.equal(show.artForm, "dance");
  assert.deepEqual(show.tags, ["dance"]);
  assert.equal(show.venue.name, "Tramway");
  assert.deepEqual(show.run, {
    opens: "2026-10-16",
    closes: "2026-10-17",
    time: "19:30",
  });
  assert.equal(show.performances.length, 2);
  assert.equal(show.performances[0].date, "2026-10-16");
  assert.equal(show.performances[0].price, 18);
  assert.equal(show.performances[1].accessibility, "BSL interpreted");
  assert.equal(show.pricing.from, 18);
  assert.equal(show.pricing.concessionFrom, 5);
  assert.equal(show.pricing.source, "venue-feed");
  assert.equal(show.image.url, "https://glasgowtheatre.com/images/thrice.webp");
  assert.equal(show.durationMinutes, 75);
  assert.equal(show.checkedAt, undefined);
  assert.equal(show.pricing.checkedAt, "2026-10-15");
  const serialised = JSON.stringify(show);
  for (const internal of ["sourceGenre", "scheduleRead", '"read"', '"type"']) {
    assert.ok(
      !serialised.includes(internal),
      `public show leaked internal field ${internal}`,
    );
  }
});

test("a missing image and missing pricing become null, not invented data", () => {
  const show = publicShow(
    event({ image: null, pricing: null, performances: [] }),
    venuesById,
  );
  assert.equal(show.image, null);
  assert.equal(show.pricing, null);
  assert.deepEqual(show.performances, []);
});

test("the dataset counts venues with shows separately from all venues", () => {
  const dataset = datasetFor();
  assert.equal(dataset.counts.shows, 1);
  assert.equal(dataset.counts.venues, 2);
  assert.equal(dataset.counts.venuesWithShows, 1);
  const tron = dataset.venues.find((venue) => venue.id === "tron");
  const tramway = dataset.venues.find((venue) => venue.id === "tramway");
  assert.equal(tron.upcomingShows, 0);
  assert.equal(tron.colour, "#e01c70");
  assert.equal(tron.ink, "#ffffff");
  assert.equal(tramway.colour, "#4a4f57");
  assert.equal(tramway.ink, "#ffffff");
  assert.equal(tramway.concessions.summary, "Concessions at Tramway.");
});

test("empty and inverted ranges are rejected rather than silently empty", () => {
  assert.throws(
    () => parseQuery(new URLSearchParams("from=2026-10-31&to=2026-10-01")),
    (error) => error instanceof ApiError && error.status === 400,
  );
  assert.throws(
    () => parseQuery(new URLSearchParams("date=2026-02-31")),
    (error) => error instanceof ApiError && error.status === 400,
  );
  assert.throws(
    () => parseQuery(new URLSearchParams("limit=0")),
    (error) => error instanceof ApiError && error.status === 400,
  );
  assert.throws(
    () => parseQuery(new URLSearchParams("date=2026-10-17&from=2026-10-01")),
    (error) => error instanceof ApiError && error.status === 400,
  );
});

test("date filters match overlapping runs, not only openings", () => {
  const shows = datasetFor([
    event(),
    event({
      id: "one-night",
      title: "One Night",
      date: "2026-10-20",
      endDate: null,
      venueId: "tron",
      venue: "Tron Theatre",
      form: "play",
      tags: ["play"],
    }),
  ]).shows;
  const params = parseQuery(
    new URLSearchParams("from=2026-10-17&to=2026-10-17"),
  );
  const result = filterShows(shows, params);
  assert.deepEqual(result.shows.map((show) => show.id), ["thrice-2026"]);
});

test("venue, form, price, search and pagination compose", () => {
  const dataset = datasetFor([
    event(),
    event({
      id: "cheap-play",
      title: "A Cheap Play",
      venueId: "tron",
      venue: "Tron Theatre",
      form: "play",
      date: "2026-10-18",
      endDate: null,
      pricing: {
        from: 8,
        to: null,
        concession: null,
        concessionTo: null,
        free: false,
        payWhatYouLike: false,
        text: "£8",
        read: "model",
      },
    }),
    event({
      id: "free-show",
      title: "Free Show",
      venueId: "tron",
      venue: "Tron Theatre",
      form: "play",
      date: "2026-10-19",
      endDate: null,
      pricing: {
        from: 0,
        to: null,
        concession: null,
        concessionTo: null,
        free: true,
        payWhatYouLike: false,
        text: "Free",
        read: "model",
      },
    }),
  ]);
  const cheap = filterShows(
    dataset.shows,
    parseQuery(new URLSearchParams("form=play&maxPrice=10&sort=price")),
  );
  assert.deepEqual(cheap.shows.map((show) => show.id), ["free-show", "cheap-play"]);
  const search = filterShows(
    dataset.shows,
    parseQuery(new URLSearchParams("q=cheap&venue=tron")),
  );
  assert.deepEqual(search.shows.map((show) => show.id), ["cheap-play"]);
  const free = filterShows(
    dataset.shows,
    parseQuery(new URLSearchParams("free=true")),
  );
  assert.deepEqual(free.shows.map((show) => show.id), ["free-show"]);
  const page = filterShows(
    dataset.shows,
    parseQuery(new URLSearchParams("limit=1&offset=1&sort=title")),
  );
  assert.equal(page.total, 3);
  assert.equal(page.shows.length, 1);
  assert.equal(page.shows[0].title, "Free Show");
});

test("the text view is a header plus one tab-separated line per show", () => {
  const text = showsToText(datasetFor().shows);
  const lines = text.trimEnd().split("\n");
  assert.equal(lines[0], "# opens\tcloses\ttitle\tvenue\tartForm\tfromPrice\turl");
  assert.equal(
    lines[1],
    "2026-10-16\t2026-10-17\tThrice\tTramway\tdance\t18\thttps://glasgowtheatre.com/shows/thrice-2026.html",
  );
});

test("the build writes the documented snapshots and never leaks internals", () => {
  const { files, dataset } = buildApiFiles({
    events: [event()],
    venues,
    concessions: { tramway: { summary: "Concessions." } },
    status: { refreshedAt: "2026-10-15T05:00:00.000Z" },
    generatedAt: "2026-10-15T05:20:00.000Z",
  });
  for (const name of [
    "api/v1/shows.json",
    "api/v1/shows.txt",
    "api/v1/shows/thrice-2026.json",
    "api/v1/venues.json",
    "api/v1/venues/tramway.json",
    "api/v1/venues/tramway/shows.json",
    "api/v1/shows-preview.json",
    "api/v1/shows-preview.txt",
    "api/v1/meta.json",
    "api/v1/openapi.json",
    "api/v1/schema.json",
    "_headers",
    "_routes.json",
  ]) {
    assert.ok(files[name], `missing ${name}`);
  }
  assert.equal(dataset.generatedAt, "2026-10-15T05:20:00.000Z");
  const shows = JSON.parse(files["api/v1/shows.json"]);
  assert.equal(shows.total, 1);
  assert.equal(shows.shows[0].title, "Thrice");
  const serialised = JSON.stringify(files);
  for (const internal of ["sourceGenre", "scheduleRead", '"read"']) {
    assert.ok(!serialised.includes(internal), `snapshot leaked ${internal}`);
  }
  const routes = JSON.parse(files["_routes.json"]);
  assert.ok(routes.include.includes("/api/v1/shows"));
  assert.ok(routes.include.includes("/api/v1/venues/*/shows"));
});
