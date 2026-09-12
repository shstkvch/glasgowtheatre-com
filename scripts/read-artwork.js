#!/usr/bin/env node

/**
 * How a piece of artwork may be cropped.
 *
 * A social card is 4:5 and the artwork is whatever shape the venue published,
 * so something has to give. Which thing depends entirely on what the image is,
 * and nothing in the listing says: a production photograph crops beautifully,
 * while a tour poster has the performer's name set across it and any crop cuts
 * the name in half — "TAM COW", "BURLESQU".
 *
 * Shape is a tempting proxy and a bad one. Saliency cropping is worse: libvips'
 * attention strategy chases the brightest region, and on the Tron's Antigone
 * artwork it abandons the mask and the hands for a blown-out highlight. Tested
 * against centre, entropy and attention crops, a cheap vision model was the
 * only thing that got all nine of a week's images right.
 *
 * One call per image, cached by the image's own name — which is already a hash
 * of the source URL — so artwork costs a fraction of a penny the first time it
 * is seen and nothing afterwards. Reading a week's nine images cost $0.0013.
 *
 * It fails open like the tagger: without a key, or if the API is down, every
 * image falls back to the shape rule and the deck still builds.
 *
 * Usage: node scripts/read-artwork.js [--dry-run] [--reread]
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const MODEL = process.env.ARTWORK_MODEL || "google/gemini-2.5-flash-lite";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const CACHE = path.join(__dirname, "..", "data", "crop-cache.json");
const IMAGES = path.join(__dirname, "..", "src", "images");

const PROMPT = `You are preparing theatre artwork for a 4:5 social card.
Answer only with JSON: {"type":"poster"|"photo","text":"none"|"minor"|"title","focus":"top"|"upper"|"centre"|"lower"|"bottom"}
type: "poster" if the image is designed artwork with the show or performer name set into it; "photo" if it is a production or press photograph.
text: "title" if cropping the edges would cut off the show/performer name; "minor" for small credits only; "none" for no text.
focus: where the subject a crop must keep sits vertically.`;

const TYPES = new Set(["poster", "photo"]);
const TEXTS = new Set(["none", "minor", "title"]);
const FOCUSES = new Set(["top", "upper", "centre", "lower", "bottom"]);

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/**
 * Nothing the model returns is trusted on sight. A reading outside the
 * vocabulary is dropped rather than corrected, and a dropped reading means
 * the image falls back to the shape rule — which is wrong sometimes, where a
 * made-up value would be wrong silently.
 */
function validate(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw).replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
  const { type, text, focus } = parsed || {};
  if (!TYPES.has(type) || !TEXTS.has(text) || !FOCUSES.has(focus)) return null;
  return { type, text, focus };
}

/** The image, small enough to be cheap to look at and big enough to read. */
async function thumbnail(file) {
  return (await sharp(file).resize(512, 512, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer())
    .toString("base64");
}

async function ask(file) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      usage: { include: true },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${await thumbnail(file)}` },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return {
    reading: validate(body.choices?.[0]?.message?.content),
    cost: body.usage?.cost || 0,
  };
}

/**
 * How a card should treat one image.
 *
 * Where the name is set into the artwork there is no honest crop, so the image
 * is sat whole on the venue's colour instead. Everything else is cropped, from
 * wherever the subject actually is.
 */
function cropFor(reading, width, height) {
  if (!reading) {
    // No reading: fall back to shape. A wide banner or a square social tile is
    // usually a poster; the frame's own proportions are usually a photograph.
    const ratio = width / height;
    return ratio > 1.55 || (ratio > 0.95 && ratio < 1.1)
      ? { fit: "contain" }
      : { fit: "cover", position: "50%" };
  }
  if (reading.text === "title") return { fit: "contain" };
  const position = { top: "0%", upper: "25%", centre: "50%", lower: "75%", bottom: "100%" }[
    reading.focus
  ];
  return { fit: "cover", position };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const reread = args.includes("--reread");
  const cache = reread ? {} : read(CACHE, {});

  const events = read(path.join(__dirname, "..", "data", "events.json"), []);
  const images = read(path.join(__dirname, "..", "data", "image-cache.json"), {});
  const wanted = [
    ...new Set(
      events
        .map((e) => (e.image?.startsWith("/") ? e.image : images[e.image]))
        .filter(Boolean)
        .map((p) => path.basename(p)),
    ),
  ].filter((name) => fs.existsSync(path.join(IMAGES, name)));

  // Every image's own shape, read off the file. The site needs it to stop
  // forcing a 1.6 frame on a portrait production shot, and it costs nothing,
  // so it is recorded whether or not the model is ever asked about the image.
  let measured = 0;
  for (const name of wanted) {
    if (cache[name]?.w) continue;
    try {
      const { width, height } = await sharp(path.join(IMAGES, name)).metadata();
      cache[name] = { ...(cache[name] || {}), w: width, h: height };
      measured += 1;
    } catch (err) {
      console.log(`  ! ${name}: could not be measured (${err.message})`);
    }
  }
  if (measured) console.log(`Measured ${measured} images`);

  const todo = wanted.filter((name) => !cache[name]?.focus);
  console.log(`${wanted.length} images, ${todo.length} to read`);

  const save = () => {
    if (dryRun) return console.log("Dry run — cache not written");
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n");
  };

  if (!todo.length) return save();
  if (!process.env.OPENROUTER_API_KEY) {
    console.log("  ! No OPENROUTER_API_KEY — every image falls back to its shape");
    return save();
  }

  let cost = 0;
  let read_ = 0;
  for (const name of todo) {
    const file = path.join(IMAGES, name);
    try {
      const { reading, cost: spent } = await ask(file);
      cost += spent;
      if (!reading) {
        console.log(`  ? ${name}: unreadable answer, falling back to shape`);
        continue;
      }
      cache[name] = { ...(cache[name] || {}), ...reading };
      read_ += 1;
      console.log(`  ${name}: ${reading.type}, text ${reading.text}, focus ${reading.focus}`);
    } catch (err) {
      // An outage must never empty the deck; the shape rule stands.
      console.log(`  ! ${name}: ${err.message}`);
    }
  }

  console.log(`Read ${read_} images for $${cost.toFixed(6)}`);
  if (dryRun) return console.log("Dry run — cache not written");
  save();
  fs.writeFileSync(
    path.join(__dirname, "..", "data", "artwork-usage.json"),
    JSON.stringify({ at: new Date().toISOString(), imagesRead: read_, costUsd: cost }, null, 2) + "\n",
  );
}

if (require.main === module) main();

module.exports = { cropFor, validate };
