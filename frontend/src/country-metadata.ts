import worldCountryFlagAnchors from "./world-country-flag-anchors.json";

type RawCountryInfo = {
  summary?: unknown;
  capitals?: unknown;
  largest_city?: unknown;
  continents?: unknown;
  regions?: unknown;
  population?: {
    value?: unknown;
    as_of?: unknown;
  } | null;
  official_languages?: unknown;
  heads_of_state?: {
    values?: unknown;
    as_of?: unknown;
  } | null;
  gdp_nominal?: {
    value?: unknown;
    as_of?: unknown;
    currency?: unknown;
  } | null;
  currencies?: unknown;
  time_zones?: unknown;
  source?: {
    wikipedia_title?: unknown;
    wikipedia_url?: unknown;
    wikidata_id?: unknown;
  } | null;
  last_enriched_at?: unknown;
} | null;

type RawCountryMetadata = {
  iso2?: unknown;
  name?: unknown;
  area?: unknown;
  country_info?: RawCountryInfo;
};

export type CountryMetadataSource = {
  wikipediaTitle: string | null;
  wikipediaUrl: string | null;
  wikidataId: string | null;
};

export type CountryMetadataInfo = {
  summary: string | null;
  capitals: string[];
  largestCity: string | null;
  continents: string[];
  regions: string[];
  population: {
    value: number | null;
    asOf: string | null;
  };
  officialLanguages: string[];
  headsOfState: {
    values: string[];
    asOf: string | null;
  };
  gdpNominal: {
    value: number | null;
    asOf: string | null;
    currency: string | null;
  };
  currencies: string[];
  timeZones: string[];
  source: CountryMetadataSource;
  lastEnrichedAt: string | null;
};

export type CountryMetadata = {
  iso2: string;
  name: string;
  area: number | null;
  countryInfo: CountryMetadataInfo | null;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => entry !== null))];
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeIso2(value: unknown): string | null {
  const normalizedValue = normalizeString(value)?.toUpperCase() ?? null;
  if (!normalizedValue || !/^[A-Z]{2}$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function normalizeCountryInfo(rawInfo: RawCountryInfo): CountryMetadataInfo | null {
  if (!rawInfo || typeof rawInfo !== "object") {
    return null;
  }

  return {
    summary: normalizeString(rawInfo.summary),
    capitals: normalizeStringArray(rawInfo.capitals),
    largestCity: normalizeString(rawInfo.largest_city),
    continents: normalizeStringArray(rawInfo.continents),
    regions: normalizeStringArray(rawInfo.regions),
    population: {
      value: normalizeFiniteNumber(rawInfo.population?.value),
      asOf: normalizeString(rawInfo.population?.as_of)
    },
    officialLanguages: normalizeStringArray(rawInfo.official_languages),
    headsOfState: {
      values: normalizeStringArray(rawInfo.heads_of_state?.values),
      asOf: normalizeString(rawInfo.heads_of_state?.as_of)
    },
    gdpNominal: {
      value: normalizeFiniteNumber(rawInfo.gdp_nominal?.value),
      asOf: normalizeString(rawInfo.gdp_nominal?.as_of),
      currency: normalizeString(rawInfo.gdp_nominal?.currency)
    },
    currencies: normalizeStringArray(rawInfo.currencies),
    timeZones: normalizeStringArray(rawInfo.time_zones),
    source: {
      wikipediaTitle: normalizeString(rawInfo.source?.wikipedia_title),
      wikipediaUrl: normalizeString(rawInfo.source?.wikipedia_url),
      wikidataId: normalizeString(rawInfo.source?.wikidata_id)
    },
    lastEnrichedAt: normalizeString(rawInfo.last_enriched_at)
  };
}

function normalizeCountryMetadata(rawMetadata: RawCountryMetadata): CountryMetadata | null {
  const iso2 = normalizeIso2(rawMetadata.iso2);
  if (!iso2) {
    return null;
  }

  return {
    iso2,
    name: normalizeString(rawMetadata.name) ?? iso2,
    area: normalizeFiniteNumber(rawMetadata.area),
    countryInfo: normalizeCountryInfo(rawMetadata.country_info ?? null)
  };
}

const COUNTRY_METADATA_BY_ISO2 = (worldCountryFlagAnchors as RawCountryMetadata[]).reduce<Record<string, CountryMetadata>>((lookup, rawMetadata) => {
  const normalizedMetadata = normalizeCountryMetadata(rawMetadata);
  if (!normalizedMetadata) {
    return lookup;
  }

  const currentMetadata = lookup[normalizedMetadata.iso2];
  const shouldReplaceCurrent = !currentMetadata
    || (!currentMetadata.countryInfo && Boolean(normalizedMetadata.countryInfo))
    || ((normalizedMetadata.area ?? 0) > (currentMetadata.area ?? 0));

  if (shouldReplaceCurrent) {
    lookup[normalizedMetadata.iso2] = normalizedMetadata;
  }

  return lookup;
}, {});

export function getCountryMetadata(flagCode: string): CountryMetadata | null {
  const iso2 = normalizeIso2(flagCode);
  return iso2 ? COUNTRY_METADATA_BY_ISO2[iso2] ?? null : null;
}