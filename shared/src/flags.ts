export const FULL_FLAG_CATALOG = [
  "us", "ca", "mx", "cu", "br", "ar", "co", "pe", "ve", "cl", "ec", "uy",
  "gb", "ie", "fr", "de", "it", "es", "pt", "nl", "be", "ch", "se", "no",
  "fi", "dk", "pl", "cz", "at", "gr", "tr", "ua", "ro", "hu", "rs", "bg",
  "za", "ng", "eg", "ke", "ma", "dz", "gh", "et", "tz", "cm", "sn", "tn",
  "cn", "in", "jp", "kr", "au", "nz", "id", "th", "vn", "my", "ph", "sg",
  "pk", "bd", "sa", "ae", "il", "ir", "iq", "qa", "kw", "om", "jo", "lb"
] as const;

export const ROOM_DIFFICULTIES = ["easy", "medium", "hard", "007"] as const;

export type RoomDifficulty = (typeof ROOM_DIFFICULTIES)[number];

export const DIFFICULTY_FLAG_COUNTS: Record<Exclude<RoomDifficulty, "007">, number> = {
  easy: 24,
  medium: 36,
  hard: 48
};

export function getDifficultyFlagCount(difficulty: RoomDifficulty, fullCatalogCount: number = FULL_FLAG_CATALOG.length): number {
  if (difficulty === "007") {
    return fullCatalogCount;
  }
  return DIFFICULTY_FLAG_COUNTS[difficulty];
}
