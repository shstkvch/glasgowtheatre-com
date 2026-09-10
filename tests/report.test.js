const test = require("node:test");
const assert = require("node:assert");

const {
  emailBody,
  quietBody,
  taggingLine,
  summaryLines,
  money,
} = require("../scripts/report-new.js");

const show = {
  id: "x1",
  title: "The Cherry Orchard",
  venue: "Citizens Theatre",
  date: "2026-10-01",
  endDate: "2026-10-11",
  ticketUrl: "https://example.com/t",
  form: "play",
  tags: ["play"],
};

const status = (extra = {}) => ({
  builtAt: "2026-09-10T05:18:36.287Z",
  refreshedAt: "2026-09-10T05:18:33.940Z",
  retainedVenues: [],
  ...extra,
});

test("money shows zero spend as £0.00", () => {
  assert.strictEqual(money(0), "£0.00");
  assert.strictEqual(money(undefined), "£0.00");
});

test("money keeps sub-penny spend legible", () => {
  // A tagging run costs about $0.001; £0.00 would read as free.
  assert.match(money(0.001), /^£0\.\d{4}$/);
  assert.strictEqual(money(10), "£7.90");
});

test("tagging line reports £0.00 when nothing was tagged", () => {
  const line = taggingLine(
    status({ tagging: { at: "2026-09-10T05:18:35Z", totalTokens: 0, costUsd: 0 } }),
  );
  assert.match(line, /nothing new to tag/);
  assert.match(line, /£0\.00/);
});

test("tagging line reports tokens and cost when tagging happened", () => {
  const line = taggingLine(
    status({
      tagging: {
        at: "2026-09-10T05:18:35Z",
        listingsTagged: 3,
        totalTokens: 12431,
        costUsd: 0.0012,
      },
    }),
  );
  assert.match(line, /12,431 tokens/);
  assert.match(line, /3 listings/);
  assert.match(line, /£0\.00\d\d/);
});

test("a usage file left over from an earlier run is not reported as today's", () => {
  const line = taggingLine(
    status({
      tagging: { at: "2026-09-09T14:55:00Z", totalTokens: 9000, costUsd: 0.002 },
    }),
  );
  assert.match(line, /did not run/);
  assert.match(line, /£0\.00/);
});

test("missing usage is treated as no spend", () => {
  assert.match(taggingLine(status()), /£0\.00/);
  assert.match(taggingLine(null), /£0\.00/);
});

test("the quiet email says the job ran and what it cost", () => {
  const message = quietBody(48, status());
  assert.match(message.subject, /no new shows/i);
  assert.match(message.text, /48 shows listed/);
  assert.match(message.text, /£0\.00/);
  assert.match(message.html, /£0\.00/);
});

test("the new-shows email carries the cost too", () => {
  const message = emailBody([show], 48, status());
  assert.match(message.subject, /1 new show on Glasgow Theatre/);
  assert.match(message.text, /The Cherry Orchard/);
  assert.match(message.text, /£0\.00/);
  assert.match(message.html, /£0\.00/);
});

test("retained venues are called out in the summary", () => {
  const lines = summaryLines(48, status({ retainedVenues: ["tron"] }));
  assert.ok(lines.some((line) => /Serving saved listings for: tron/.test(line)));
});
