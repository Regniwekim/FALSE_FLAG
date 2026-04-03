import { FULL_FLAG_CATALOG } from "@flagwho/shared";

export const FLAG_CATALOG = [...FULL_FLAG_CATALOG] as const;

export function isValidFlagCode(flagCode: unknown): flagCode is string {
  return typeof flagCode === "string" && FLAG_CATALOG.includes(flagCode as (typeof FLAG_CATALOG)[number]);
}

export function isFlagCodeInList(flagCode: unknown, availableFlagCodes: string[]): flagCode is string {
  return typeof flagCode === "string" && availableFlagCodes.includes(flagCode);
}
