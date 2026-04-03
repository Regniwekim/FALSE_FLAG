import fs from "node:fs/promises";
import path from "node:path";

const ID_TO_CODE = {
  BQBO: "BQ",
  BQSA: "BQ",
  BQSE: "BQ"
};

const FLAGS_FILE = path.resolve("shared/src/flags.ts");
const MARKERS_FILE = path.resolve("frontend/src/world-map-marker-positions.ts");
const ANCHORS_FILE = path.resolve("frontend/src/world-country-flag-anchors.json");

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has("--write");
const shouldCheck = args.has("--check");

if (shouldWrite && shouldCheck) {
  throw new Error("Use either --write or --check, not both.");
}

function normalizeFlagCode(rawCode) {
  if (typeof rawCode !== "string") {
    return null;
  }

  const normalized = rawCode.trim().toUpperCase();
  const mapped = ID_TO_CODE[normalized] ?? normalized;
  return /^[A-Z]{2}$/.test(mapped) ? mapped : null;
}

function parseCoordinate(rawValue, label) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${String(rawValue)}`);
  }

  return Number(parsed.toFixed(2));
}

function parseArea(rawValue) {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectPreferredAnchor(current, candidate) {
  if (!current) {
    return candidate;
  }

  return candidate.area > current.area ? candidate : current;
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n");
}

function updateFlagCatalog(flagsText, catalogSource) {
  const catalogPattern = /export const FULL_FLAG_CATALOG = \[[\s\S]*?\] as const;/;
  if (!catalogPattern.test(flagsText)) {
    throw new Error(`Could not find FULL_FLAG_CATALOG in ${path.relative(process.cwd(), FLAGS_FILE)}.`);
  }

  return flagsText.replace(
    catalogPattern,
    `export const FULL_FLAG_CATALOG = [\n  ${catalogSource}\n] as const;`
  );
}

const anchorsText = await fs.readFile(ANCHORS_FILE, "utf8");
const anchorEntries = JSON.parse(anchorsText);

if (!Array.isArray(anchorEntries)) {
  throw new Error("Expected the world-country-flag-anchors.json file to contain an array.");
}

const anchorsByCode = new Map();

for (const entry of anchorEntries) {
  if (!entry || typeof entry !== "object") {
    continue;
  }

  const code = normalizeFlagCode(entry.iso2);
  if (!code) {
    continue;
  }

  if (!Array.isArray(entry.flag_anchor) || entry.flag_anchor.length < 2) {
    throw new Error(`Missing flag_anchor for ${String(entry.iso2 ?? entry.key ?? entry.name ?? "unknown")}.`);
  }

  const candidate = {
    x: parseCoordinate(entry.flag_anchor[0], `${code} x`),
    y: parseCoordinate(entry.flag_anchor[1], `${code} y`),
    area: parseArea(entry.area)
  };

  anchorsByCode.set(code, selectPreferredAnchor(anchorsByCode.get(code), candidate));
}

const codes = Array.from(anchorsByCode.keys()).sort();

const markerEntries = codes.map((code) => {
  const marker = anchorsByCode.get(code);
  if (!marker) {
    throw new Error(`Missing normalized flag anchor for ${code}.`);
  }

  return `  ${code.toLowerCase()}: { x: ${marker.x}, y: ${marker.y} },`;
});

const markerSource = `export type FlagMarkerPositions = Record<string, { x: number; y: number }>;

export const WORLD_MAP_MARKER_POSITIONS: FlagMarkerPositions = {
${markerEntries.join("\n")}
};
`;

const catalogSource = codes.map((code) => `"${code.toLowerCase()}"`).join(", ");
const flagsText = await fs.readFile(FLAGS_FILE, "utf8");
const updatedFlagsText = updateFlagCatalog(flagsText, catalogSource);

if (shouldWrite) {
  await fs.writeFile(MARKERS_FILE, markerSource, "utf8");
  await fs.writeFile(FLAGS_FILE, updatedFlagsText, "utf8");

  console.log(`Updated ${path.relative(process.cwd(), MARKERS_FILE)} and ${path.relative(process.cwd(), FLAGS_FILE)}.`);
  console.log(`Country count: ${codes.length}`);
} else if (shouldCheck) {
  const markerText = await fs.readFile(MARKERS_FILE, "utf8");
  const staleFiles = [];

  if (normalizeLineEndings(markerText) !== normalizeLineEndings(markerSource)) {
    staleFiles.push(path.relative(process.cwd(), MARKERS_FILE));
  }

  if (normalizeLineEndings(flagsText) !== normalizeLineEndings(updatedFlagsText)) {
    staleFiles.push(path.relative(process.cwd(), FLAGS_FILE));
  }

  if (staleFiles.length > 0) {
    console.error("Generated flag data is out of date.");
    for (const staleFile of staleFiles) {
      console.error(`- ${staleFile}`);
    }
    console.error("Run `node scripts/recalculate-flag-centroids.mjs --write` to regenerate them.");
    process.exit(1);
  }

  console.log(`Generated flag data is up to date. Country count: ${codes.length}`);
} else {
  console.log(`Country count: ${codes.length}`);
  console.log(codes.map((code) => code.toLowerCase()).join(","));
}
