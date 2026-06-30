# Spin Down Dice Tracker

A small static helper for _The Binding of Isaac: Repentance_ Spin Down Dice runs.

Type any item pedestal you see, and the page shows the next items in Spin Down order. Add target items such as Sacred Heart, Godhead, or Glitched Crown, and each temporary check highlights whether one of those targets is coming up.

It is especially handy in Greed Mode shops, but it is not limited to shops. It works anywhere you have Spin Down Dice and need to evaluate a visible item.

## Features

- Fast item entry with name and typo-tolerant autocomplete
- Multiple temporary item checks
- 20-second auto-clear for quick reroll checks
- `Keep` button for items you want to keep on screen
- Target item list
- Collapsible reverse route view
- Static files only, suitable for GitHub Pages

## Run Locally

```bash
npm run serve
```

Open:

```text
http://localhost:4173/
```

`http://127.0.0.1:4173/` works too.

## Data

The item route is generated from:

```text
data/spindown-items.csv
```

Regenerate the browser catalog after editing the CSV:

```bash
npm run build:data
```

The generated file is:

```text
src/data/items.js
```

Extra keyword and AI-tag sources are optional. The build reads `data/guru-keywords.json` and `data/ai-tags.json` when present, or paths given via the `SPINDOWN_GURU_KEYWORDS` and `SPINDOWN_AI_TAGS` environment variables. The committed `src/data/items.js` already has all data baked in, so cloners never need to run the build.

Search runs entirely in the browser over item names, cleaned name tokens, and a set of search keywords sourced from [isaacguru.com](https://isaacguru.com), with a small Levenshtein fallback for typos. The scoring logic itself is original to this project; no third-party search *scripts* are bundled.

## Deploy

This repo is plain static HTML/CSS/JS — no build step is needed to publish. Pick either host.

### GitHub Pages

1. Push the repo to GitHub.
2. Open repository settings.
3. Go to Pages.
4. Deploy from the default branch root.

### Cloudflare Pages

1. In the Cloudflare dashboard, create a Pages project connected to the repo (or `wrangler pages deploy .`).
2. Leave the build command empty and set the output directory to the repo root (`.`).

## Project Layout

```text
.
├── assets/collectibles/      # item sprite PNGs
├── data/spindown-items.csv   # Spin Down item order
├── docs/architecture.d2      # project diagram
├── scripts/build-data.mjs    # CSV -> browser catalog
├── src/app.js                # application logic
├── src/data/items.js         # generated catalog
├── src/styles.css            # interface styling
└── index.html
```

## Credits

- **Search keywords** — sourced from [isaacguru.com](https://isaacguru.com), used with credit.
- **Item sprites** — the `collectibles_###.png` set, sourced from the [Rebirth Item Tracker](https://github.com/Rchardon/RebirthItemTracker) (BSD-2-Clause). The sprites themselves are game artwork © Nicalis / Edmund McMillen.

## Notices

This is an unofficial fan tool and is not affiliated with Nicalis, Edmund McMillen, or the owners of _The Binding of Isaac_.

The code is licensed separately from game artwork. See [NOTICE.md](NOTICE.md).
