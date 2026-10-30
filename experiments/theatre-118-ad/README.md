# Theatre 118 interactive ad

A self-contained HTML ad experiment. Nothing is added to the live site or its build.

From `site/`:

```sh
python3 -m http.server 4187 --bind 127.0.0.1 --directory experiments/theatre-118-ad
```

Open http://127.0.0.1:4187 for the preview, or `/ad.html` for the ad itself. The preview has desktop/mobile controls and a replay button.

- Desktop billboard: 970 × 250, also adapts to narrower desktop placements.
- Mobile: 300px high, adapts to widths from 320px.
- Curtains open on entry; messages rotate every 5.5 seconds.
- Hover or keyboard focus suspends rotation. Scene buttons let visitors choose the message. The pause control stops motion; reduced-motion preferences start with a static ad.
- The spotlight follows the pointer. The ticket opens https://theatre118.com/whats-on.
- No cookies, analytics, external scripts, audio, or runtime dependencies.

Brand reference, logo and performance photograph: https://theatre118.com/ (retrieved 30 October 2026). Typefaces: Anton and Bricolage Grotesque, locally hosted; licenses are in `assets/`. Promotional headlines are creative copy for this experiment. Pay What You Can availability was confirmed on Theatre 118’s programme.

## Check

With the server running, from `site/`:

```sh
node experiments/theatre-118-ad/check.cjs
```

Uses the existing Playwright dependency and installed Chrome. Checks automatic/manual rotation, keyboard activation, booking destination, responsive bounds, reduced motion, preview controls, replay and browser/resource errors. It does not contact the booking site during the check.

## Using it later

Serve `ad.html`, `ad.css`, `ad.js` and `assets/` together, and embed the HTML in a titled iframe. This is an HTML creative, rather than an animated image: the future ad manager would need an HTML creative type to retain its interactions. A sandbox allowing scripts and new-tab navigation can isolate the creative from the host page. The gallery, check script and README are not part of the ad.
