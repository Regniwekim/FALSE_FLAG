export function isFlagCodeInList(flagCode, availableFlagCodes) {
    return typeof flagCode === "string" && availableFlagCodes.includes(flagCode);
}
