const { londonDate } = require('../src/js/listings');

// Keep common listing boilerplate from counting as a shared subject.
const stop = new Set(`a an and are as at be been but by can come discover for from get has have her his how in into is it its just more new not of on one or our out see she show shows that the theatre their them there these they this through tickets to us was we what when where which who will with you your glasgow also about all after back first most much than then very two play plays performance performances production productions`.split(' '));
const canonical = url => (url || '').replace(/\/$/, '');
function words(event) {
  return new Set([event.title, event.description, ...(event.tags || [])].join(' ')
    .toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[’']/g, '')
    .match(/[a-z]{3,}/g)?.filter(word => !stop.has(word)) || []);
}
function recommend(current, events, { today = londonDate(), excludeUrls = [], limit = 3 } = {}) {
  const excluded = new Set([canonical(current.ticketUrl), ...excludeUrls.map(canonical)]);
  const seenIds = new Set([current.id]);
  const seenUrls = new Set(excluded);
  const candidates = events.filter(event => {
    const url = canonical(event.ticketUrl);
    if (!url || seenUrls.has(url) || seenIds.has(event.id) || (event.endDate || event.date) < today) return false;
    seenIds.add(event.id); seenUrls.add(url);
    return true;
  });
  const documents = [current, ...candidates].map(words);
  const frequency = new Map();
  for (const document of documents) for (const word of document) frequency.set(word, (frequency.get(word) || 0) + 1);
  const weight = word => Math.log(1 + documents.length / frequency.get(word));
  const norm = document => Math.sqrt([...document].reduce((sum, word) => sum + weight(word) ** 2, 0));
  const subject = documents[0];
  const subjectNorm = norm(subject);
  return candidates.map((event, index) => {
    const terms = documents[index + 1];
    const shared = [...terms].filter(word => subject.has(word));
    const denominator = subjectNorm * norm(terms);
    const keywordScore = denominator ? shared.reduce((sum, word) => sum + weight(word) ** 2, 0) / denominator : 0;
    const sameForm = !!current.form && event.form === current.form;
    const sameVenue = !!current.venueId && event.venueId === current.venueId;
    const tags = [...new Set(current.tags || [])].filter(tag => tag !== current.form && (event.tags || []).includes(tag));
    const daysApart = Math.abs(Date.parse(event.date) - Date.parse(current.date)) / 86400000;
    const score = (sameForm ? 6 : 0) + (sameVenue ? 3 : 0) + Math.min(tags.length * 2, 4) + keywordScore * 8 + (Number.isFinite(daysApart) ? 0.5 / (1 + daysApart / 30) : 0);
    const reason = sameVenue ? `Also at ${event.venue}` : sameForm ? 'Similar shows' : shared.length ? 'Similar themes' : 'Coming up in Glasgow';
    return { event, score, reason, sharedKeywords: shared };
  }).sort((a, b) => b.score - a.score || a.event.date.localeCompare(b.event.date) || a.event.id.localeCompare(b.event.id)).slice(0, limit);
}
module.exports = { recommend };
