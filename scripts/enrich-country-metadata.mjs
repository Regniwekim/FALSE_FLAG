import fs from "node:fs/promises";
import path from "node:path";

const ANCHORS_FILE = path.resolve("frontend/src/world-country-flag-anchors.json");
const DEFAULT_CONCURRENCY = 2;
const ENTITY_BATCH_SIZE = 50;
const MIN_REQUEST_INTERVAL_MS = 300;
const USER_AGENT = "FALSE_FLAG-country-metadata-enricher/0.1";

const IDENTITY_CODE_MAP = {
  BQBO: "BQ",
  BQSA: "BQ",
  BQSE: "BQ"
};

const TITLE_OVERRIDES = {
  BL: {
    searchQuery: "Saint Barthelemy"
  },
  BN: {
    wikipediaTitle: "Brunei"
  },
  BQ: {
    wikipediaTitle: "Caribbean Netherlands",
    searchQuery: "Bonaire Sint Eustatius and Saba"
  },
  CG: {
    wikipediaTitle: "Republic of the Congo"
  },
  CI: {
    wikipediaTitle: "Ivory Coast",
    searchQuery: "Cote d'Ivoire"
  },
  FO: {
    wikipediaTitle: "Faroe Islands"
  },
  FM: {
    wikipediaTitle: "Federated States of Micronesia"
  },
  GE: {
    wikipediaTitle: "Georgia (country)"
  },
  GM: {
    wikipediaTitle: "The Gambia"
  },
  KR: {
    wikipediaTitle: "South Korea"
  },
  KP: {
    wikipediaTitle: "North Korea"
  },
  LA: {
    wikipediaTitle: "Laos"
  },
  MD: {
    wikipediaTitle: "Moldova"
  },
  MF: {
    wikipediaTitle: "Collectivity of Saint Martin",
    searchQuery: "Saint Martin France"
  },
  MK: {
    wikipediaTitle: "North Macedonia"
  },
  PS: {
    wikipediaTitle: "State of Palestine"
  },
  RE: {
    searchQuery: "Reunion island"
  },
  RU: {
    wikipediaTitle: "Russia"
  },
  ST: {
    searchQuery: "Sao Tome and Principe"
  },
  SZ: {
    wikipediaTitle: "Eswatini"
  },
  TL: {
    wikipediaTitle: "East Timor"
  },
  "canary-islands-spain": {
    wikipediaTitle: "Canary Islands"
  }
};

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has("--write");
const codesArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--codes="));
const concurrencyArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--concurrency="));

const selectedCodes = new Set(
  (codesArgument ? codesArgument.slice("--codes=".length).split(",") : [])
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toUpperCase())
);

const concurrency = (() => {
  if (!concurrencyArgument) {
    return DEFAULT_CONCURRENCY;
  }

  const parsed = Number.parseInt(concurrencyArgument.slice("--concurrency=".length), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }

  return parsed;
})();

const labelCache = new Map();
const requestQueues = new Map();

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeFlagCode(rawCode) {
  if (typeof rawCode !== "string") {
    return null;
  }

  const normalized = rawCode.trim().toUpperCase();
  const mapped = IDENTITY_CODE_MAP[normalized] ?? normalized;
  return mapped || null;
}

function getIdentityKey(entry) {
  const normalizedCode = normalizeFlagCode(entry.iso2);
  if (normalizedCode) {
    return normalizedCode;
  }

  if (typeof entry.key === "string" && entry.key.trim()) {
    return entry.key.trim().toUpperCase();
  }

  if (typeof entry.name === "string" && entry.name.trim()) {
    return entry.name.trim().toUpperCase();
  }

  throw new Error("Encountered an anchor entry without a usable identity.");
}

function getSelectionTokens(entry, identityKey) {
  const tokens = new Set([identityKey.toUpperCase()]);

  if (typeof entry.iso2 === "string" && entry.iso2.trim()) {
    tokens.add(entry.iso2.trim().toUpperCase());
  }

  if (typeof entry.key === "string" && entry.key.trim()) {
    tokens.add(entry.key.trim().toUpperCase());
  }

  return tokens;
}

function shouldProcessEntry(entry, identityKey) {
  if (selectedCodes.size === 0) {
    return true;
  }

  for (const token of getSelectionTokens(entry, identityKey)) {
    if (selectedCodes.has(token)) {
      return true;
    }
  }

  return false;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function buildTitleCandidates(entry, identityKey) {
  const override = TITLE_OVERRIDES[identityKey];
  const candidates = new Set();

  if (override?.wikipediaTitle) {
    candidates.add(override.wikipediaTitle);
  }

  if (typeof entry.name === "string" && entry.name.trim()) {
    const name = entry.name.trim();
    candidates.add(name);
    candidates.add(name.replace(/\s*\([^)]*\)\s*/g, " ").trim());
    candidates.add(name.replace(/\bSt\.\b/g, "Saint").trim());
    candidates.add(name.replace(/\bDem\.\s*Rep\.\b/g, "Democratic Republic").trim());
  }

  return [...candidates].filter(Boolean);
}

function getSearchQueries(entry, identityKey) {
  const override = TITLE_OVERRIDES[identityKey];
  const queries = [];

  if (override?.searchQuery) {
    queries.push(override.searchQuery);
  }

  if (typeof entry.name === "string" && entry.name.trim()) {
    queries.push(entry.name.trim());
    queries.push(entry.name.replace(/\s*\([^)]*\)\s*/g, " ").trim());
  }

  if (typeof entry.key === "string" && entry.key.trim() && !/^[A-Z0-9]{2,4}$/i.test(entry.key.trim())) {
    queries.push(entry.key.replace(/[-_]+/g, " ").trim());
  }

  return uniqueValues(queries);
}

function normalizeSummary(summary) {
  return {
    extract: typeof summary.extract === "string" ? summary.extract.replace(/\s+/g, " ").trim() : null,
    title: typeof summary.title === "string" ? summary.title : null,
    wikipediaUrl: summary.content_urls?.desktop?.page ?? summary.content_urls?.mobile?.page ?? null,
    wikidataId: typeof summary.wikibase_item === "string" ? summary.wikibase_item : null,
    type: typeof summary.type === "string" ? summary.type : null
  };
}

function isUsableSummary(summary) {
  return Boolean(summary && summary.wikidataId && summary.type !== "disambiguation");
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchJson(url, { allowNotFound = false } = {}) {
  const delays = [0, 1500, 4000, 9000];

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(delays[attempt]);
    }

    try {
      const response = await enqueueRequest(url, () => fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT
        }
      }));

      if (response.status === 404 && allowNotFound) {
        return null;
      }

      if (response.ok) {
        return response.json();
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterDelay = Number.parseInt(retryAfterHeader ?? "", 10);
        if (Number.isFinite(retryAfterDelay) && retryAfterDelay > 0) {
          await sleep(retryAfterDelay * 1000);
        }
        continue;
      }

      const body = await response.text();
      throw new Error(`Request failed with ${response.status}: ${body.slice(0, 240)}`);
    } catch (error) {
      if (attempt < delays.length - 1) {
        continue;
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(String(error));
    }
  }

  throw new Error(`Request failed after retries for ${url}`);
}

async function enqueueRequest(url, task) {
  const host = new URL(url).host;
  const previous = requestQueues.get(host) ?? Promise.resolve();
  let release;

  const current = new Promise((resolve) => {
    release = resolve;
  });

  requestQueues.set(host, previous.catch(() => undefined).then(() => current));
  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    await sleep(MIN_REQUEST_INTERVAL_MS);
    release();
  }
}

async function fetchWikipediaSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summary = await fetchJson(url, { allowNotFound: true });
  return summary ? normalizeSummary(summary) : null;
}

async function searchWikipediaTitles(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=5&srsearch=${encodeURIComponent(query)}`;
  const response = await fetchJson(url);
  const results = response?.query?.search;
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .map((result) => (typeof result.title === "string" ? result.title : null))
    .filter(Boolean);
}

async function resolveWikipediaPage(entry, identityKey) {
  const attemptedTitles = new Set();

  for (const candidateTitle of buildTitleCandidates(entry, identityKey)) {
    const normalizedCandidate = candidateTitle.toLowerCase();
    if (attemptedTitles.has(normalizedCandidate)) {
      continue;
    }
    attemptedTitles.add(normalizedCandidate);

    const summary = await fetchWikipediaSummary(candidateTitle);
    if (isUsableSummary(summary)) {
      return summary;
    }
  }

  for (const searchQuery of getSearchQueries(entry, identityKey)) {
    const titles = await searchWikipediaTitles(searchQuery);
    for (const title of titles) {
      const normalizedCandidate = title.toLowerCase();
      if (attemptedTitles.has(normalizedCandidate)) {
        continue;
      }
      attemptedTitles.add(normalizedCandidate);

      const summary = await fetchWikipediaSummary(title);
      if (isUsableSummary(summary)) {
        return summary;
      }
    }
  }

  throw new Error(`Unable to resolve a Wikipedia article for ${entry.name}.`);
}

async function fetchWikidataEntity(entityId) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(entityId)}&languages=en&format=json&props=claims|labels`;
  const response = await fetchJson(url);
  const entity = response?.entities?.[entityId];
  if (!entity) {
    throw new Error(`Unable to load Wikidata entity ${entityId}.`);
  }

  return entity;
}

function extractLabel(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  const labels = entity.labels ?? {};
  return labels.en?.value ?? labels["en-gb"]?.value ?? labels["en-ca"]?.value ?? Object.values(labels)[0]?.value ?? null;
}

async function primeLabelCache(entityIds) {
  const missingIds = [...new Set(entityIds)].filter((entityId) => entityId && !labelCache.has(entityId));

  for (const chunk of chunkValues(missingIds, ENTITY_BATCH_SIZE)) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(chunk.join("|"))}&languages=en&format=json&props=labels`;
    const response = await fetchJson(url);
    for (const entityId of chunk) {
      const label = extractLabel(response?.entities?.[entityId]);
      labelCache.set(entityId, label);
    }
  }
}

async function resolveLabels(entityIds) {
  await primeLabelCache(entityIds);
  return uniqueValues(entityIds.map((entityId) => labelCache.get(entityId) ?? null));
}

function getStatements(entity, propertyId) {
  const claims = entity?.claims?.[propertyId];
  return Array.isArray(claims) ? claims : [];
}

function getRankWeight(statement) {
  if (statement?.rank === "preferred") {
    return 2;
  }

  if (statement?.rank === "normal") {
    return 1;
  }

  return 0;
}

function getItemId(statement) {
  const value = statement?.mainsnak?.datavalue?.value;
  return value && typeof value.id === "string" ? value.id : null;
}

function getQuantity(statement) {
  const amount = statement?.mainsnak?.datavalue?.value?.amount;
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed : null;
}

function getQuantityUnitId(statement) {
  const unit = statement?.mainsnak?.datavalue?.value?.unit;
  if (typeof unit !== "string" || unit === "1") {
    return null;
  }

  const match = /\/entity\/(Q\d+)$/i.exec(unit);
  return match ? match[1] : null;
}

function parseTimeValue(value) {
  if (!value || typeof value.time !== "string") {
    return null;
  }

  const normalized = value.time.replace(/^\+/, "");
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(normalized);
  if (!match) {
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) || 1;
  const day = Number(match[3]) || 1;
  return Date.UTC(year, month - 1, day);
}

function formatTimeValue(value) {
  if (!value || typeof value.time !== "string") {
    return null;
  }

  const normalized = value.time.replace(/^\+/, "");
  const year = normalized.slice(0, 4);
  const month = normalized.slice(5, 7);
  const day = normalized.slice(8, 10);
  const precision = Number(value.precision ?? 9);

  if (precision >= 11) {
    return `${year}-${month}-${day}`;
  }

  if (precision === 10) {
    return `${year}-${month}`;
  }

  return year;
}

function getQualifierValue(statement, propertyId) {
  return statement?.qualifiers?.[propertyId]?.[0]?.datavalue?.value ?? null;
}

function getQualifierTimestamp(statement, propertyId) {
  return parseTimeValue(getQualifierValue(statement, propertyId));
}

function getQualifierFormattedDate(statement, propertyId) {
  return formatTimeValue(getQualifierValue(statement, propertyId));
}

function isCurrentStatement(statement) {
  if (getRankWeight(statement) === 0) {
    return false;
  }

  const now = Date.now();
  const startTime = getQualifierTimestamp(statement, "P580");
  const endTime = getQualifierTimestamp(statement, "P582");

  if (startTime && startTime > now) {
    return false;
  }

  if (endTime && endTime < now) {
    return false;
  }

  return true;
}

function collectItemIds(entity, propertyId, { currentOnly = false } = {}) {
  const statements = getStatements(entity, propertyId).filter((statement) => getRankWeight(statement) > 0 && getItemId(statement));
  if (statements.length === 0) {
    return [];
  }

  const candidates = currentOnly ? statements.filter(isCurrentStatement) : statements;
  const usableStatements = candidates.length > 0 ? candidates : statements;
  const highestRank = Math.max(...usableStatements.map(getRankWeight));

  return uniqueValues(
    usableStatements
      .filter((statement) => getRankWeight(statement) === highestRank)
      .map(getItemId)
  );
}

function selectLatestQuantityStatement(entity, propertyId) {
  const statements = getStatements(entity, propertyId).filter((statement) => getRankWeight(statement) > 0 && getQuantity(statement) !== null);
  if (statements.length === 0) {
    return null;
  }

  const sortedStatements = [...statements].sort((left, right) => {
    const rightDate = getQualifierTimestamp(right, "P585") ?? Number.NEGATIVE_INFINITY;
    const leftDate = getQualifierTimestamp(left, "P585") ?? Number.NEGATIVE_INFINITY;
    if (rightDate !== leftDate) {
      return rightDate - leftDate;
    }

    const rankDifference = getRankWeight(right) - getRankWeight(left);
    if (rankDifference !== 0) {
      return rankDifference;
    }

    const rightStart = getQualifierTimestamp(right, "P580") ?? Number.NEGATIVE_INFINITY;
    const leftStart = getQualifierTimestamp(left, "P580") ?? Number.NEGATIVE_INFINITY;
    return rightStart - leftStart;
  });

  return sortedStatements[0];
}

function buildQuantityInfo(statement, unitLabel) {
  if (!statement) {
    return {
      value: null,
      as_of: null,
      currency: unitLabel ?? null
    };
  }

  return {
    value: getQuantity(statement),
    as_of: getQualifierFormattedDate(statement, "P585"),
    currency: unitLabel ?? null
  };
}

function buildHeadsOfStateInfo(values, enrichedDate) {
  return {
    values,
    as_of: values.length > 0 ? enrichedDate : null
  };
}

function collectReferencedEntityIds(entity) {
  const propertyIds = ["P30", "P35", "P36", "P37", "P38", "P421", "P706", "P13574"];
  const ids = [];

  for (const propertyId of propertyIds) {
    const currentOnly = propertyId === "P35" || propertyId === "P36" || propertyId === "P38" || propertyId === "P421";
    ids.push(...collectItemIds(entity, propertyId, { currentOnly }));
  }

  const gdpUnitId = getQuantityUnitId(selectLatestQuantityStatement(entity, "P2131"));
  if (gdpUnitId) {
    ids.push(gdpUnitId);
  }

  return uniqueValues(ids);
}

async function buildCountryInfo(entry, identityKey, enrichedTimestamp) {
  const summary = await resolveWikipediaPage(entry, identityKey);
  const entity = await fetchWikidataEntity(summary.wikidataId);
  const referencedEntityIds = collectReferencedEntityIds(entity);
  await primeLabelCache(referencedEntityIds);

  const capitals = await resolveLabels(collectItemIds(entity, "P36", { currentOnly: true }));
  const largestCityLabels = await resolveLabels(collectItemIds(entity, "P13574"));
  const continents = await resolveLabels(collectItemIds(entity, "P30"));
  const regions = await resolveLabels(collectItemIds(entity, "P706"));
  const officialLanguages = await resolveLabels(collectItemIds(entity, "P37"));
  const headsOfState = await resolveLabels(collectItemIds(entity, "P35", { currentOnly: true }));
  const currencies = await resolveLabels(collectItemIds(entity, "P38", { currentOnly: true }));
  const timeZones = await resolveLabels(collectItemIds(entity, "P421", { currentOnly: true }));
  const populationStatement = selectLatestQuantityStatement(entity, "P1082");
  const gdpStatement = selectLatestQuantityStatement(entity, "P2131");
  const gdpUnitId = getQuantityUnitId(gdpStatement);
  const gdpUnitLabel = gdpUnitId ? (await resolveLabels([gdpUnitId]))[0] ?? null : null;

  return {
    summary: summary.extract,
    capitals,
    largest_city: largestCityLabels[0] ?? null,
    continents,
    regions,
    population: {
      value: populationStatement ? getQuantity(populationStatement) : null,
      as_of: populationStatement ? getQualifierFormattedDate(populationStatement, "P585") : null
    },
    official_languages: officialLanguages,
    heads_of_state: buildHeadsOfStateInfo(headsOfState, enrichedTimestamp.slice(0, 10)),
    gdp_nominal: buildQuantityInfo(gdpStatement, gdpUnitLabel),
    currencies,
    time_zones: timeZones,
    source: {
      wikipedia_title: summary.title,
      wikipedia_url: summary.wikipediaUrl,
      wikidata_id: summary.wikidataId
    },
    last_enriched_at: enrichedTimestamp
  };
}

async function mapWithConcurrency(items, workerCount, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(workerCount, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

const anchorsText = await fs.readFile(ANCHORS_FILE, "utf8");
const anchorEntries = JSON.parse(anchorsText);

if (!Array.isArray(anchorEntries)) {
  throw new Error("Expected frontend/src/world-country-flag-anchors.json to contain an array.");
}

const groupsByIdentityKey = new Map();

for (const entry of anchorEntries) {
  const identityKey = getIdentityKey(entry);
  if (!shouldProcessEntry(entry, identityKey)) {
    continue;
  }

  const group = groupsByIdentityKey.get(identityKey);
  if (!group) {
    groupsByIdentityKey.set(identityKey, {
      identityKey,
      representativeEntry: entry,
      entries: [entry]
    });
    continue;
  }

  group.entries.push(entry);
  const currentArea = Number(group.representativeEntry.area ?? 0);
  const candidateArea = Number(entry.area ?? 0);
  if (candidateArea > currentArea) {
    group.representativeEntry = entry;
  }
}

const groups = [...groupsByIdentityKey.values()].sort((left, right) => left.identityKey.localeCompare(right.identityKey));

if (groups.length === 0) {
  throw new Error("No anchor entries matched the requested selection.");
}

const enrichedTimestamp = new Date().toISOString();
const failures = [];
const metadataByIdentityKey = new Map();
let completedCount = 0;

await mapWithConcurrency(groups, concurrency, async (group) => {
  try {
    const countryInfo = await buildCountryInfo(group.representativeEntry, group.identityKey, enrichedTimestamp);
    metadataByIdentityKey.set(group.identityKey, countryInfo);
    completedCount += 1;
    if (completedCount % 10 === 0 || completedCount === groups.length) {
      console.log(`Resolved ${completedCount}/${groups.length} country metadata records.`);
    }
  } catch (error) {
    failures.push({
      identityKey: group.identityKey,
      name: group.representativeEntry.name,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

if (failures.length > 0) {
  console.error("Country metadata enrichment failed for the following identities:");
  for (const failure of failures.sort((left, right) => left.identityKey.localeCompare(right.identityKey))) {
    console.error(`- ${failure.identityKey} (${failure.name}): ${failure.message}`);
  }
  process.exit(1);
}

const nextAnchorEntries = anchorEntries.map((entry) => {
  const identityKey = getIdentityKey(entry);
  const countryInfo = metadataByIdentityKey.get(identityKey);

  if (!countryInfo) {
    return entry;
  }

  return {
    ...entry,
    country_info: countryInfo
  };
});

if (shouldWrite) {
  await fs.writeFile(ANCHORS_FILE, `${JSON.stringify(nextAnchorEntries, null, 2)}\n`, "utf8");
  console.log(`Updated ${path.relative(process.cwd(), ANCHORS_FILE)} with ${groups.length} metadata records.`);
} else {
  console.log(`Resolved ${groups.length} metadata records. Re-run with --write to update ${path.relative(process.cwd(), ANCHORS_FILE)}.`);
}