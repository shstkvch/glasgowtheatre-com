/**
 * The art form: what kind of thing an event is. Exactly one per listing.
 *
 * This is deliberately only the form. Genre - what a piece is like once you
 * know its form - is a separate question that needs its own vocabulary, and
 * mixing the two is what made the old list unusable: "comedy" meant a stand-up
 * hour, a pantomime and a funny play all at once, so filtering for a night out
 * returned a children's panto.
 */
const FORMS = {
  play: "A play performed by actors, of any kind.",
  musical: "Musical theatre, where songs carry the story.",
  opera: "Opera or operetta.",
  dance: "Dance or choreographed movement as the main form, including ballet.",
  "stand-up": "Stand-up comedy: one or more comedians performing material.",
  cabaret: "Cabaret, variety, drag, burlesque or magic.",
  "physical-theatre": "Physical, visual, circus, puppetry, clown or mime-led work.",
  "spoken-word": "Poetry, storytelling or a live podcast performed to an audience.",
  pantomime: "Pantomime, in the British seasonal tradition.",
  talk: "A lecture, interview, panel, Q&A or pre-show conversation.",
  workshop: "A class, workshop, audition or participatory session.",
  tour: "A guided tour of the building or a behind-the-scenes visit.",
  music: "A concert or gig, where live music is the event itself.",
  "community-event": "A festival, fair, convention or celebration rather than a single performance.",
};

/**
 * Set by the scraper from the source, never by the model, and carried through
 * untouched. These describe how or where a show runs rather than what it is.
 */
const STRUCTURAL = new Set(["a-play-a-pie-a-pint", "lunchtime", "scratch"]);

const ALLOWED = new Set(Object.keys(FORMS));

/**
 * Conservative fallback when no model classification is available.
 *
 * The last resort follows the venue. At a dedicated theatre everything staged
 * is theatre, so a listing the keywords cannot place is most likely a play. At
 * a venue that programmes more than theatre the same guess is wrong the other
 * way round: most of what the Glad Café and the Old Hairdressers put on is a
 * gig, and "play" files a band at the top of the plays filter. Three of them
 * were published that way when one tagging request failed to come back.
 *
 * A guess is still a guess either way. This only makes it wrong in the
 * direction the venue's own programme points.
 */
function fallbackForm(event, { mixedProgramme = false } = {}) {
  if (ALLOWED.has(event.form)) return event.form;
  const title = event.title || "";
  const text = `${title} ${event.description || ""}`.toLowerCase();
  // Participation and visits take precedence over the art form they discuss.
  if (/\b(workshop|masterclass|audition)\b/.test(text)) return "workshop";
  if (/\b(guided|building|heritage|backstage|touch) tours?\b/.test(text)) return "tour";
  if (/\b(pre[- ]show talk|post[- ]show talk|in conversation|panel discussion|lecture)\b/.test(text)) return "talk";
  if (/\bpanto(?:mime)?\b/.test(text)) return "pantomime";
  if (/\b(opera|operetta)\b/.test(text)) return "opera";
  if (/\bmusical(?: theatre)?\b/.test(text) || title === "Guys and Dolls") return "musical";
  if (/\bstand[- ]up\b|\bcomedy night\b/.test(text)) return "stand-up";
  if (/\b(ballet|dance|choreograph\w*)\b/.test(text)) return "dance";
  if (/\b(physical theatre|circus|puppetry|mime)\b/.test(text)) return "physical-theatre";
  if (/\b(cabaret|burlesque|drag show|magic show)\b/.test(text)) return "cabaret";
  if (/\b(spoken word|poetry|storytelling)\b/.test(text)) return "spoken-word";
  if (/\b(play|drama|theatre)\b/.test(text)) return "play";
  if (/\b(concert|gig|live music)\b/.test(text)) return "music";
  if (/\b(fair|convention|community festival)\b/.test(text)) return "community-event";
  return mixedProgramme ? "music" : "play";
}

/** Keep source season metadata searchable, separate from the single art form. */
function combine(event, form, options) {
  const structural = (event.tags || []).filter((tag) => STRUCTURAL.has(tag));
  const valid = ALLOWED.has(form) ? form : fallbackForm(event, options);
  return [...new Set([valid, ...structural])];
}

module.exports = { FORMS, STRUCTURAL, ALLOWED, fallbackForm, combine };
