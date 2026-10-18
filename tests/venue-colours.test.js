const test = require("node:test");
const assert = require("node:assert");
const {
  VENUE_COLOURS,
  RESERVE,
  contrast,
  barInk,
  legible,
  laneColour,
} = require("../functions/_lib/venue-colours");

test("every house colour is legible against the ink it publishes", () => {
  for (const [id, colour] of Object.entries(VENUE_COLOURS)) {
    const adjusted = laneColour({ id }, 0);
    const ink = barInk(adjusted);
    assert.ok(legible(adjusted), `${id} is not legible`);
    assert.ok(
      contrast(adjusted, ink) >= 4.5,
      `${id} clears less than WCAG AA (${contrast(adjusted, ink).toFixed(2)})`,
    );
  }
});

test("a venue with no house colour still gets a readable reserve", () => {
  const colour = laneColour({ id: "brand-new-venue" }, 2);
  assert.equal(colour, RESERVE[2]);
  assert.ok(legible(colour));
});

test("the palette keeps the published brand colours rather than replacing them", () => {
  assert.equal(VENUE_COLOURS.tron, "#e91d75");
  assert.equal(laneColour({ id: "tron" }, 0), "#e01c70");
  assert.equal(VENUE_COLOURS.citizens, "#111111");
});
