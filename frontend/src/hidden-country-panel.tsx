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

function formatNumberWithAsOf(value: number | null, asOf: string | null): string {
  if (value === null) {
    return "Unavailable";
  }

  const asOfLabel = formatDateLabel(asOf);
  return asOfLabel ? `${integerFormatter.format(value)} (${asOfLabel})` : integerFormatter.format(value);
}

function formatGdpValue(value: number | null, currency: string | null, asOf: string | null): string {
  if (value === null) {
    return "Unavailable";
  }

  const metadataBits = [currency, formatDateLabel(asOf)].filter((entry): entry is string => Boolean(entry));
  const formattedValue = integerFormatter.format(value);
  return metadataBits.length > 0 ? `${formattedValue} (${metadataBits.join(", ")})` : formattedValue;
}

function renderUnavailablePlaceholder(): ReactNode {
  return <span className="secret-country-unavailable">Unavailable</span>;
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
    : renderUnavailablePlaceholder();

  const wikidataLink = countryInfo?.source.wikidataId
    ? (
      <a href={`https://www.wikidata.org/wiki/${countryInfo.source.wikidataId}`} rel="noreferrer" target="_blank">
        {countryInfo.source.wikidataId}
      </a>
    )
    : renderUnavailablePlaceholder();

  return [
    { label: "Capital", value: formatList(countryInfo?.capitals ?? []) },
    { label: "Largest city", value: countryInfo?.largestCity ?? renderUnavailablePlaceholder() },
    { label: "Continent", value: formatList(countryInfo?.continents ?? []) },
    { label: "Region", value: formatList(countryInfo?.regions ?? []) },
    { label: "Population", value: formatNumberWithAsOf(countryInfo?.population.value ?? null, countryInfo?.population.asOf ?? null) },
    { label: "Languages", value: formatList(countryInfo?.officialLanguages ?? []) },
    { label: "Head of state", value: countryInfo?.headsOfState.values.length ? formatList(countryInfo.headsOfState.values) + (formatDateLabel(countryInfo.headsOfState.asOf) ? ` (${formatDateLabel(countryInfo.headsOfState.asOf)})` : "") : renderUnavailablePlaceholder() },
    { label: "Nominal GDP", value: formatGdpValue(countryInfo?.gdpNominal.value ?? null, countryInfo?.gdpNominal.currency ?? null, countryInfo?.gdpNominal.asOf ?? null) },
    { label: "Currency", value: formatList(countryInfo?.currencies ?? []) },
    { label: "Time zone", value: formatList(countryInfo?.timeZones ?? []) },
    { label: "Wikipedia", value: wikipediaLink },
    { label: "Wikidata", value: wikidataLink },
    { label: "Refreshed", value: formatDateLabel(countryInfo?.lastEnrichedAt ?? null) ?? renderUnavailablePlaceholder() }
  ];
}

function buildCompactCountryInfoboxRows(
  countryInfo: CountryMetadataInfo | null
): CountryInfoboxRow[] {
  const primaryRegion = countryInfo?.regions[0] ?? null;
  const primaryContinent = countryInfo?.continents[0] ?? null;

  return [
    { label: "Capital", value: formatList(countryInfo?.capitals ?? []) },
    {
      label: primaryRegion ? "Region" : "Continent",
      value: primaryRegion ?? primaryContinent ?? renderUnavailablePlaceholder()
    },
    { label: "Population", value: formatNumberWithAsOf(countryInfo?.population.value ?? null, countryInfo?.population.asOf ?? null) }
  ];
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
  const compactRows = useMemo(() => buildCompactCountryInfoboxRows(metadata?.countryInfo ?? null), [metadata?.countryInfo]);
  const infoboxClassName = ["secret-country-infobox", "map-flag-preview", className ?? ""].filter(Boolean).join(" ");

  return (
    <aside className={infoboxClassName} data-testid={dataTestId}>
      <div className="map-flag-preview-header">
        <img src={toFlagImage(flagCode)} alt={`${countryName} flag`} loading="lazy" />
        <div className="map-flag-preview-copy">
          <p className="map-flag-preview-kicker">Intel Snapshot</p>
          <h3 className="map-flag-preview-title">{countryName}</h3>
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