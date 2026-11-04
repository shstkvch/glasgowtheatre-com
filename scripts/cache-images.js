const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { mergeListings, filterEvents } = require("../src/js/listings");
const dir = path.join(__dirname, "..", "src", "images");
const ogDir = path.join(dir, "og");
const manifestPath = path.join(__dirname, "..", "data", "image-cache.json");
// What each piece of artwork looks like, from scripts/read-artwork.js. Absent
// on a first run, and absent for artwork that arrived since; the crop then
// falls back to the middle and is corrected on the next pass.
const readings = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "data", "crop-cache.json"), "utf8"),
    );
  } catch {
    return {};
  }
})();
/**
 * The picture a link preview shows, cut from the same artwork as the card.
 *
 * Facebook and LinkedIn still drop WebP previews, so this is a JPEG at the
 * 1.91:1 size a large preview wants, rather than the 16:10 card image. A
 * poster is cropped from the top, where its title is, and anything wider
 * from the middle — which is the focus the artwork reading already chose.
 * Built here because this is the pass that already has the artwork in hand;
 * the page falls back to the site card when it is missing.
 */
async function shareImage(source, name) {
  const dest = path.join(ogDir, name.replace(/\.webp$/, ".jpg"));
  const reading = readings[name] || {};
  const position =
    reading.focus === "upper" || reading.text === "title"
      ? "north"
      : reading.focus === "lower"
        ? "south"
        : "centre";
  await sharp(source)
    .rotate()
    .resize({ width: 1200, height: 630, fit: "cover", position })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(dest);
}
async function main() {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(ogDir, { recursive: true });
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath))
    : {};
  const events = filterEvents(
    mergeListings(
      require("../data/events.json"),
      require("../data/manual-events.json"),
    ),
  );
  let failed = 0;
  for (let i = 0; i < events.length; i += 4) {
    await Promise.all(
      events.slice(i, i + 4).map(async (event) => {
        const url = event.image;
        if (!url || url.startsWith("/")) return;
        const name =
          crypto.createHash("sha256").update(url).digest("hex").slice(0, 20) +
          ".webp";
        const dest = path.join(dir, name);
        if (fs.existsSync(dest)) {
          manifest[url] = "/images/" + name;
          // The cached artwork may predate share cards; fill them in.
          await shareImage(dest, name);
          return;
        }
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(25000),
          });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const buffer = Buffer.from(await response.arrayBuffer());
          await sharp(buffer)
            .rotate()
            .resize({ width: 1100, withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(dest);
          await shareImage(buffer, name);
          manifest[url] = "/images/" + name;
        } catch (error) {
          failed++;
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          delete manifest[url];
          console.warn(
            `Image unavailable for ${event.title}: ${error.message}`,
          );
        }
      }),
    );
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `Images cached: ${events.length - failed}; unavailable: ${failed} (use venue artwork).`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
