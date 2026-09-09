const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { mergeListings, filterEvents } = require("../src/js/listings");
const dir = path.join(__dirname, "..", "src", "images");
const manifestPath = path.join(__dirname, "..", "data", "image-cache.json");
async function main() {
  fs.mkdirSync(dir, { recursive: true });
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
