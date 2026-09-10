const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  readPricing,
  priceLabel,
  concessionSource,
  timesLabel,
  headlineTime,
  clockTime,
  readDuration,
  durationLabel,
  money,
} = require("../scripts/tickets");

/* Every string below is one a venue actually published on the day this was
   written, so a change in the reading shows up as a change in these prices. */

test("a price band keeps its top and bottom", () => {
  const citz = readPricing("£14 - £43.50");
  assert.equal(citz.from, 14);
  assert.equal(citz.to, 43.5);
  assert.equal(citz.concession, null);
  assert.equal(priceLabel(citz), "From £14");
});

test("full price and concession separated only by a slash", () => {
  const tramway = readPricing("£20/£12");
  assert.equal(tramway.from, 20);
  assert.equal(tramway.concession, 12);
  assert.equal(priceLabel(tramway), "£20 (conc. £12)");
});

test("a bare figure after a concession is another reduction, not a full price", () => {
  const platform = readPricing("£10.50 (standard) | £7 (concession) | £6");
  assert.equal(platform.from, 10.5);
  assert.equal(platform.to, null);
  assert.equal(platform.concession, 6);
  assert.equal(priceLabel(platform), "£10.50 (conc. from £6)");
});

test("price points across a run are all standard prices", () => {
  const tron = readPricing("Previews: £16 | Main Run: £19, £23 or £26");
  assert.equal(tron.from, 16);
  assert.equal(tron.to, 26);
  assert.equal(tron.concession, null);
  assert.equal(priceLabel(tron), "From £16");
});

test("prices listed by day of the week", () => {
  const oranMor = readPricing("Monday: £17\nTuesday-Friday: £19\nSaturday: £22.50");
  assert.equal(oranMor.from, 17);
  assert.equal(oranMor.to, 22.5);
  assert.equal(priceLabel(oranMor), "From £17");
});

test("a sentence with one price in it", () => {
  const glad = readPricing("Tickets £12 in advance");
  assert.equal(glad.from, 12);
  assert.equal(glad.to, null);
  assert.equal(priceLabel(glad), "£12");
});

test("free events, however the venue says it", () => {
  assert.equal(priceLabel(readPricing("Free")), "Free");
  assert.equal(priceLabel(readPricing("Standard Price : 0.00")), "Free");
  assert.equal(readPricing("Free").from, 0);
});

test("pay what you like is a suggestion, not a price band", () => {
  const platform = readPricing("Pay-What-You-Like");
  assert.equal(platform.payWhatYouLike, true);
  assert.equal(priceLabel(platform), "Pay what you like");
  assert.equal(priceLabel(readPricing("Pay-What-You-Like, suggested £5")), "£5 suggested");
});

test("no published price is no price, never a guess", () => {
  assert.equal(readPricing(""), null);
  assert.equal(priceLabel(null), null);
  assert.equal(priceLabel(readPricing("Times and tickets at the venue")), null);
});

test("the published wording survives the reading of it", () => {
  assert.equal(readPricing("£14 - £43.50").text, "£14 - £43.50");
});

const citzScheme = {
  schemes: [
    { name: "Gorbals Pass", price: 5, broad: true },
    { name: "Low Income Pass", price: 5, broad: true },
    { name: "Under 30s Pass", price: 10, broad: true },
    { name: "Access Pass", broad: true },
    { name: "Schools", price: 10, broad: false },
  ],
};

test("a venue-wide pass fills the concession a show does not publish", () => {
  const label = priceLabel(readPricing("£14 - £43.50"), citzScheme);
  assert.equal(label, "From £14 (conc. from £5)");
  const source = concessionSource(readPricing("£14 - £43.50"), citzScheme);
  assert.deepEqual(source.schemes, ["Gorbals Pass", "Low Income Pass"]);
  assert.equal(source.price, 5);
});

test("a show's own concession beats the venue pass", () => {
  const pricing = readPricing("£10.50 (standard) | £7 (concession) | £6");
  assert.equal(priceLabel(pricing, citzScheme), "£10.50 (conc. from £6)");
  assert.equal(concessionSource(pricing, citzScheme), null);
});

test("a pass is never quoted as cheaper than the show already is", () => {
  assert.equal(priceLabel(readPricing("£5"), citzScheme), "£5");
  assert.equal(priceLabel(readPricing("Free"), citzScheme), "Free");
});

const run = [
  { date: "2026-09-10", time: "19:30" },
  { date: "2026-09-11", time: "19:30" },
  { date: "2026-09-12", time: "14:30" },
  { date: "2026-09-12", time: "19:30" },
  { date: "2026-09-13", time: "15:00" },
];

test("curtain times read as a person would say them", () => {
  assert.equal(clockTime("19:30"), "7.30pm");
  assert.equal(clockTime("13:00"), "1pm");
  assert.equal(clockTime("12:00"), "noon");
  assert.equal(clockTime("10:30"), "10.30am");
  assert.equal(clockTime("nonsense"), null);
});

test("one time is the time, two are both named, more are matinees", () => {
  assert.equal(timesLabel([{ time: "19:30" }]), "7.30pm");
  assert.equal(timesLabel([{ time: "14:30" }, { time: "19:30" }]), "2.30pm & 7.30pm");
  assert.equal(timesLabel(run), "7.30pm & matinees");
  assert.equal(
    timesLabel([{ time: "11:00" }, { time: "13:00" }, { time: "15:00" }]),
    "Times vary",
  );
});

test("with no schedule the listing's own time still shows", () => {
  assert.equal(timesLabel([], "13:00"), "1pm");
  assert.equal(timesLabel([], null), null);
});

test("the headline time is the one the run uses most", () => {
  assert.equal(headlineTime(run), "19:30");
  assert.equal(headlineTime([]), null);
});

test("running times parse from however they are written", () => {
  assert.equal(readDuration("Approx 2 hours 50 minutes (including interval)"), 170);
  assert.equal(readDuration("2 hours  35 minutes"), 155);
  assert.equal(readDuration(90), 90);
  assert.equal(readDuration("Running time to be confirmed"), null);
  assert.equal(durationLabel(170), "2h 50m");
  assert.equal(durationLabel(90), "1h 30m");
  assert.equal(durationLabel(60), "1h");
});

test("pence only appear where a venue charges them", () => {
  assert.equal(money(14), "£14");
  assert.equal(money(43.5), "£43.50");
  assert.equal(money(null), null);
});
