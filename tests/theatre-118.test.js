const test = require("node:test");
const assert = require("node:assert/strict");

const {
  theatre118Events,
  theatre118Pricing,
} = require("../scripts/scrape-events.js");
const { ALLOWED } = require("../scripts/art-forms.js");

const feed = {
  venue: { name: "Theatre 118", pay_what_you_can: true },
  shows: [
    {
      id: 1,
      slug: "sleeping-beauty",
      url: "https://theatre118.com/whats-on/sleeping-beauty",
      title: "Sleeping Beauty",
      company: "Theatre 118",
      type: "Show",
      start_date: "2026-12-16",
      end_date: "2026-12-19",
      description: "Theatre 118's irreverent take on panto returns.",
      runtime_minutes: 100,
      accessibility: "Step-free access at the Payne Street entrance.",
      image: { url: "https://theatre118.com/storage/poster.jpg", alt: null },
      performances: [
        {
          date: "2026-12-16",
          time: "20:00",
          cancelled: false,
          sold_out: false,
          booking_url: "https://theatre118.com/book/380",
        },
        {
          date: "2026-12-17",
          time: "20:00",
          cancelled: false,
          sold_out: true,
          booking_url: null,
        },
      ],
      ticketing: {
        pay_what_you_can: true,
        ticket_types: [
          { name: "Standard Admission", kind: "fixed", price: 1200 },
          { name: "Pay What You Can", kind: "pay_what_you_can", price: 1200 },
        ],
      },
    },
    {
      id: 2,
      slug: "intro-to-devising",
      url: "https://theatre118.com/whats-on/intro-to-devising",
      title: "Intro to Devising",
      company: "Theatre 118",
      type: "Workshop",
      start_date: "2026-11-10",
      end_date: null,
      description: "A participatory workshop for makers.",
      runtime_minutes: null,
      performances: [
        { date: "2026-11-10", time: "18:30", cancelled: false, sold_out: false, booking_url: "https://theatre118.com/book/400" },
      ],
      ticketing: {
        pay_what_you_can: true,
        ticket_types: [],
      },
    },
  ],
};

test("a 118 feed becomes Glasgow Theatre listings", () => {
  const events = theatre118Events(feed);
  assert.equal(events.length, 2);

  const [panto, workshop] = events;

  assert.equal(panto.venue, "Theatre 118");
  assert.equal(panto.venueId, "theatre-118");
  assert.equal(panto.date, "2026-12-16");
  assert.equal(panto.endDate, "2026-12-19");
  // The show's own stable page, not a link to one performance that sells out.
  assert.equal(panto.ticketUrl, "https://theatre118.com/whats-on/sleeping-beauty");
  assert.equal(panto.image, "https://theatre118.com/storage/poster.jpg");
  assert.equal(panto.duration, 100);
  assert.equal(panto.accessibility, "Step-free access at the Payne Street entrance.");
  assert.equal(panto.producer, "Theatre 118");
  // A panto is sold by its own type; "Show" is left for the tagger.
  assert.equal(panto.type, "professional");

  // Prices come back in pounds, and Pay What You Can is on every show.
  assert.equal(panto.pricing.from, 12);
  assert.equal(panto.pricing.payWhatYouLike, true);
  assert.equal(panto.pricing.read, "source");

  // The schedule is the venue's own, so no pass should re-read it.
  assert.equal(panto.time, "20:00");
  assert.equal(panto.performances.length, 2);
  assert.equal(panto.performances[0].url, "https://theatre118.com/book/380");
  assert.equal(panto.performances[1].note, "Sold out");
});

test("a workshop is community, with its own art form", () => {
  const [, workshop] = theatre118Events(feed);
  assert.equal(workshop.type, "community");
  assert.equal(workshop.form, "workshop");
  assert.ok(ALLOWED.has(workshop.form));
});

test("Pay What You Can with no fixed price is still a price", () => {
  const pricing = theatre118Pricing({ pay_what_you_can: true, ticket_types: [] });
  assert.equal(pricing.from, null);
  assert.equal(pricing.payWhatYouLike, true);
});

test("a free show is free, not a £0 ticket", () => {
  const pricing = theatre118Pricing({
    pay_what_you_can: false,
    ticket_types: [{ name: "Free", kind: "fixed", price: 0 }],
  });
  assert.equal(pricing.free, true);
  assert.equal(pricing.from, 0);
});

test("the lowest and highest fixed prices become the band", () => {
  const pricing = theatre118Pricing({
    ticket_types: [
      { name: "Standard", kind: "fixed", price: 1500 },
      { name: "Under 16", kind: "fixed", price: 800 },
      { name: "Pay What You Can", kind: "pay_what_you_can", price: 1200 },
    ],
  });
  assert.equal(pricing.from, 8);
  assert.equal(pricing.to, 15);
});
