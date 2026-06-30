import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const csvPath = path.join(root, "data", "spindown-items.csv");
const outputPath = path.join(root, "src", "data", "items.js");
const guruKeywordsPaths = [
  path.join(root, "data", "guru-keywords.json"),
  process.env.SPINDOWN_GURU_KEYWORDS,
].filter(Boolean);
const aiTagsPaths = [
  path.join(root, "data", "ai-tags.json"),
  process.env.SPINDOWN_AI_TAGS,
].filter(Boolean);

function parseCsv(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const comma = line.lastIndexOf(",");
      return {
        name: line.slice(0, comma).trim(),
        id: Number(line.slice(comma + 1)),
      };
    })
    .filter((row) => Number.isFinite(row.id));
}

function cleanName(value) {
  return String(value)
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9?]+/g, "");
}

function loadGuruKeywords() {
  const source = guruKeywordsPaths.find((filePath) => fs.existsSync(filePath));
  if (!source) return { source: null, records: {} };
  return {
    source: path.relative(root, source),
    records: JSON.parse(fs.readFileSync(source, "utf8")),
  };
}

function loadAiTags() {
  const source = aiTagsPaths.find((filePath) => fs.existsSync(filePath));
  if (!source) return { source: null, records: {} };
  return {
    source: path.relative(root, source),
    records: JSON.parse(fs.readFileSync(source, "utf8")),
  };
}

function cleanTags(tags) {
  const stop = new Set([
    "the_binding_of_isaac",
    "binding_of_isaac",
    "video_game",
    "game",
    "game_item",
    "item",
    "sprite",
    "pixel_art",
    "icon",
    "object",
    "collectible",
    "powerup",
    "upgrade",
  ]);
  const seen = new Set();
  const cleaned = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = String(tag).trim().toLowerCase();
    if (!value || stop.has(value) || seen.has(value)) continue;
    seen.add(value);
    cleaned.push(value);
    if (cleaned.length >= 12) break;
  }
  return cleaned;
}

const csvItems = parseCsv(fs.readFileSync(csvPath, "utf8"));
const guruKeywords = loadGuruKeywords();
const aiTags = loadAiTags();

const items = csvItems
  .sort((a, b) => a.id - b.id)
  .map(({ id, name }) => {
    const guru = guruKeywords.records[`c${id}`] || {};
    const ai = aiTags.records[String(id)] || {};
    const tags = cleanTags(ai.tags);
    return {
      id,
      name,
      cleanName: guru.clean_name || cleanName(name),
      keywords: String(guru.keywords || "").trim().toLowerCase(),
      tags,
      searchText: [guru.keywords, ...tags, ai.caption, ai.dominantColor]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      words: name.toLowerCase().match(/[a-z0-9?]+/g) || [],
      image: `assets/collectibles/collectibles_${String(id).padStart(3, "0")}.png`,
    };
  });

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `window.ISAAC_SPINDOWN_DATA = ${JSON.stringify({ items })};\n`);

console.log(`Built ${items.length} Spin Down items into ${path.relative(root, outputPath)}`);
console.log(
  guruKeywords.source
    ? `Merged IsaacGuru search keywords from ${guruKeywords.source}`
    : "No IsaacGuru search keyword file found",
);
console.log(
  aiTags.source
    ? `Merged AI search tags from ${aiTags.source}`
    : "No AI search tag file found",
);
