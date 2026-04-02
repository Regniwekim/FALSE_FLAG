export const FLAG_CATALOG = [
  "us", "ca", "mx", "cu", "br", "ar",
  "co", "pe", "gb", "fr", "de", "it",
  "za", "ng", "eg", "ke", "cn", "in",
  "jp", "kr", "au", "nz", "tr", "sa"
] as const;

export function isValidFlagCode(flagCode: unknown): flagCode is string {
  return typeof flagCode === "string" && FLAG_CATALOG.includes(flagCode as (typeof FLAG_CATALOG)[number]);
}
