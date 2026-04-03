import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getCountryMetadata, type CountryMetadataInfo } from "./country-metadata";

type HiddenCountryPanelProps = {
  flagCode: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
};

type CountryInfoboxRow = {
  label: string;
  value: ReactNode;
};

type CompactCountryInfoboxProps = {
  flagCode: string;
  className?: string;
  dataTestId?: string;
};

const integerFormatter = new Intl.NumberFormat("en-US");
const utcMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
  year: "numeric"
});
const utcDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric"
});

function toFlagImage(flagCode: string): string {
  return `https://flagcdn.com/w80/${flagCode}.png`;
}

function formatDateLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (/^\d{4}$/.test(value)) {
    return value;
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    return utcMonthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return utcDateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
  }

  const parsedTimestamp = Date.parse(value);
  if (Number.isNaN(parsedTimestamp)) {
    return value;
  }

  return utcDateFormatter.format(new Date(parsedTimestamp));
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "Unavailable";
}

function formatGdpValue(value: number | null, currency: string | null, asOf: string | null): string {
  if (value === null) {
    return "Unavailable";
  }

  const metadataBits = [currency, formatDateLabel(asOf)].filter((entry): entry is string => Boolean(entry));
  const formattedValue = integerFormatter.format(value);
  return metadataBits.length > 0 ? `${formattedValue} (${metadataBits.join(", ")})` : formattedValue;
}

function buildCountryInfoboxRows(
  countryInfo: CountryMetadataInfo | null,
  countryName: string
): CountryInfoboxRow[] {
  const wikipediaTitle = countryInfo?.source.wikipediaTitle ?? countryName;
  const wikipediaLink = countryInfo?.source.wikipediaUrl
    ? (
      <a href={countryInfo.source.wikipediaUrl} rel="noreferrer" target="_blank">
        {wikipediaTitle}
      </a>
    )
    : null;

  const populationValue = countryInfo?.population.value ?? null;

  const rows: (CountryInfoboxRow | null)[] = [
    (countryInfo?.capitals?.length) ? { label: "Capital", value: formatList(countryInfo.capitals) } : null,
    countryInfo?.largestCity ? { label: "Largest city", value: countryInfo.largestCity } : null,
    (countryInfo?.continents?.length) ? { label: "Continent", value: formatList(countryInfo.continents) } : null,
    (countryInfo?.regions?.length) ? { label: "Region", value: formatList(countryInfo.regions) } : null,
    populationValue !== null ? { label: "Population", value: integerFormatter.format(populationValue) } : null,
    (countryInfo?.officialLanguages?.length) ? { label: "Languages", value: formatList(countryInfo.officialLanguages) } : null,
    countryInfo?.headsOfState.values.length ? { label: "Head of state", value: formatList(countryInfo.headsOfState.values) } : null,
    countryInfo?.gdpNominal.value !== null && countryInfo?.gdpNominal.value !== undefined ? { label: "Nominal GDP", value: formatGdpValue(countryInfo.gdpNominal.value, countryInfo.gdpNominal.currency ?? null, countryInfo.gdpNominal.asOf ?? null) } : null,
    (countryInfo?.currencies?.length) ? { label: "Currency", value: formatList(countryInfo.currencies) } : null,
    (countryInfo?.timeZones?.length) ? { label: "Time zone", value: formatList(countryInfo.timeZones) } : null,
    wikipediaLink ? { label: "Wikipedia", value: wikipediaLink } : null
  ];

  return rows.filter((row): row is CountryInfoboxRow => row !== null);
}

function buildCompactCountryInfoboxRows(
  countryInfo: CountryMetadataInfo | null
): CountryInfoboxRow[] {
  const primaryRegion = countryInfo?.regions[0] ?? null;
  const primaryContinent = countryInfo?.continents[0] ?? null;
  const populationValue = countryInfo?.population.value ?? null;

  const rows: (CountryInfoboxRow | null)[] = [
    (countryInfo?.capitals?.length) ? { label: "Capital", value: formatList(countryInfo.capitals) } : null,
    (primaryRegion || primaryContinent)
      ? {
        label: primaryRegion ? "Region" : "Continent",
        value: primaryRegion ?? primaryContinent!
      }
      : null,
    populationValue !== null ? { label: "Population", value: integerFormatter.format(populationValue) } : null
  ];

  return rows.filter((row): row is CountryInfoboxRow => row !== null);
}

function CountryInfoboxRows({ rows }: { rows: CountryInfoboxRow[] }) {
  return (
    <dl className="secret-country-infobox-list">
      {rows.map((row) => (
        <div className="secret-country-infobox-row" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CompactCountryInfobox({ flagCode, className, dataTestId }: CompactCountryInfoboxProps) {
  const iso2 = flagCode.toUpperCase();
  const metadata = useMemo(() => getCountryMetadata(flagCode), [flagCode]);
  const countryName = metadata?.name ?? iso2;
  const wikipediaUrl = metadata?.countryInfo?.source?.wikipediaUrl ?? null;
  const compactRows = useMemo(() => buildCompactCountryInfoboxRows(metadata?.countryInfo ?? null), [metadata?.countryInfo]);
  const infoboxClassName = ["secret-country-infobox", "map-flag-preview", className ?? ""].filter(Boolean).join(" ");

  return (
    <aside className={infoboxClassName} data-testid={dataTestId}>
      <div className="map-flag-preview-header">
        <img src={toFlagImage(flagCode)} alt={`${countryName} flag`} loading="lazy" />
        <div className="map-flag-preview-copy">
          <p className="map-flag-preview-kicker">Intel Snapshot</p>
          <h3 className="map-flag-preview-title">
            {wikipediaUrl
              ? <a href={wikipediaUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{countryName}</a>
              : countryName}
          </h3>
          <p className="map-flag-preview-iso">{iso2}</p>
        </div>
      </div>

      <CountryInfoboxRows rows={compactRows} />
    </aside>
  );
}

export function HiddenCountryPanel({ flagCode, isExpanded, onToggleExpanded }: HiddenCountryPanelProps) {
  const detailsId = useId();
  const detailsShellRef = useRef<HTMLDivElement | null>(null);
  const [detailsHeight, setDetailsHeight] = useState(0);
  const iso2 = flagCode.toUpperCase();
  const metadata = useMemo(() => getCountryMetadata(flagCode), [flagCode]);
  const countryName = metadata?.name ?? iso2;
  const countryInfo = metadata?.countryInfo;
  const summaryText = countryInfo?.summary ?? `${countryName} country profile is unavailable.`;

  const infoboxRows = useMemo<CountryInfoboxRow[]>(() => buildCountryInfoboxRows(countryInfo ?? null, countryName), [countryInfo, countryName]);

  useEffect(() => {
    const shell = detailsShellRef.current;
    if (!shell) {
      return;
    }

    const updateHeight = () => {
      setDetailsHeight(shell.scrollHeight);
    };

    updateHeight();

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => {
        updateHeight();
      });
      resizeObserver.observe(shell);

      return () => {
        resizeObserver.disconnect();
      };
    }

    window.addEventListener("resize", updateHeight);

    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, [flagCode, infoboxRows, summaryText]);

  const detailsWrapStyle = {
    maxHeight: isExpanded ? `${detailsHeight}px` : "0px"
  } as CSSProperties;

  return (
    <section
      className={isExpanded ? "secret-slot secret-country-panel secret-country-panel-expanded" : "secret-slot secret-country-panel secret-country-panel-collapsed"}
      data-testid="hidden-country-panel"
    >
      <div className="secret-country-header">
        <div className="secret-country-header-copy">
          <span className="secret-country-header-label">YOUR HIDDEN COUNTRY</span>
          <span className="secret-country-header-separator" aria-hidden="true">-</span>
          <strong className="secret-country-header-iso" data-testid="hidden-country-iso">{iso2}</strong>
          <span className="secret-country-header-separator" aria-hidden="true">-</span>
          <img className="secret-country-header-flag" src={toFlagImage(flagCode)} alt="" aria-hidden="true" loading="lazy" />
        </div>

        <button
          type="button"
          className="desktop-window-collapse secret-country-toggle"
          aria-controls={detailsId}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} hidden country details`}
          onClick={onToggleExpanded}
        >
          {isExpanded ? "-" : "+"}
        </button>
      </div>

      <div
        className="secret-country-details-wrap"
        data-testid="hidden-country-details"
        id={detailsId}
        aria-hidden={!isExpanded}
        style={detailsWrapStyle}
      >
        <div className="secret-country-details-shell" ref={detailsShellRef}>
          <div className="secret-country-layout">
            <article className="secret-country-summary" data-testid="hidden-country-summary">
              <p className="secret-country-section-label">Country Summary</p>
              <h3 className="secret-country-summary-title">{countryName}</h3>
              <p>{summaryText}</p>
            </article>

            <aside className="secret-country-infobox" data-testid="hidden-country-infobox">
              <div className="secret-country-infobox-header">
                <img src={toFlagImage(flagCode)} alt={`${countryName} flag`} loading="lazy" />
              </div>

              <CountryInfoboxRows rows={infoboxRows} />
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}