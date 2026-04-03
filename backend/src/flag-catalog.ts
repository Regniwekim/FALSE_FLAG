export function isFlagCodeInList(flagCode: unknown, availableFlagCodes: string[]): flagCode is string {
  return typeof flagCode === "string" && availableFlagCodes.includes(flagCode);
}
