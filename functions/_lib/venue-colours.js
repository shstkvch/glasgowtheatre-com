/**
 * The venue palette, shared by the website's calendar and the public API.
 *
 * This file has no Node or Workers dependencies so it can be bundled into the
 * Pages Function. The API publishes the same adjusted colour and ink the
 * calendar draws, which keeps third-party clients (including theatre-cli) in
 * step with the site.
 */
"use strict";

/* Each venue wears its own house colour, taken from its own branding: the
   Citz's black, the Tron's pink, ATG's electric purple at the King's, the
   orange A Play, a Pie and a Pint prints its posters in. Where a venue has no
   colour of its own — a black-and-white identity, or no site to read one from
   — it gets one from the reserve that nothing else has claimed, and the reason
   is noted beside it. */
const VENUE_COLOURS = {
  citizens: "#111111", // black-and-white typographic identity
  tron: "#e91d75", // the Tron's pink, from its own stylesheet
  tramway: "#4a4f57", // monochrome too — graphite, so it is not the Citz
  "oran-mor": "#e74825", // the orange of the Byres Road building it runs in
  "glad-cafe": "#f0bd0f", // the Glad's yellow
  platform: "#6626ff", // its own purple, close to the King's ATG violet
  "southside-fringe": "#0051c3",
  cottiers: "#314e42", // the green Cottiers builds its site on
  kings: "#5a00ff", // ATG electric purple
  "theatre-royal": "#d0202d", // ATG red, and the auditorium's own
  pavilion: "#256d58", // its accent green; the masthead navy reads as black
  "old-hairdressers": "#6f7f3a", // the olive running through its artwork
  "theatre-118": "#ff5b1e", // 118's brand orange, from its own stylesheet
  mono: "#0e7c8c", // no colour of its own: reserve teal
};
const RESERVE = ["#b039d8", "#ff9500", "#2ad4c8", "#8c1c5a", "#3e6815"];
const luminance = (hex) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + [0.2126, 0.7152, 0.0722][i] * v, 0);
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** Whichever of the two house inks the title will actually be legible in. */
const barInk = (colour) =>
  contrast(colour, "#ffffff") >= contrast(colour, "#20202c")
    ? "#ffffff"
    : "#20202c";
const legible = (colour) => contrast(colour, barInk(colour)) >= 4.5;
/** Moves a colour towards black or white, keeping its hue and saturation. */
function shade(hex, amount) {
  const towards = amount < 0 ? 0 : 255;
  const mix = Math.abs(amount);
  return (
    "#" +
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .map((v) => Math.round(v + (towards - v) * mix))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
/**
 * A few brand colours land in the band where neither white nor near-black
 * text quite clears WCAG AA on them. Rather than pick a different colour, the
 * bar takes the smallest step towards black or white that makes its own title
 * readable — the Tron is still the Tron's pink.
 */
function readable(colour) {
  if (legible(colour)) return colour;
  for (let step = 0.02; step <= 0.5; step += 0.02)
    for (const shifted of [shade(colour, -step), shade(colour, step)])
      if (legible(shifted)) return shifted;
  return colour;
}
/** A venue with no colour anywhere is still a lane, so nothing goes unpainted. */
function laneColour(venue, index) {
  return readable(
    VENUE_COLOURS[venue.id] || RESERVE[index % RESERVE.length],
  );
}

module.exports = {
  VENUE_COLOURS,
  RESERVE,
  contrast,
  barInk,
  legible,
  readable,
  laneColour,
};
