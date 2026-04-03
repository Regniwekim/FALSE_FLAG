export const FULL_FLAG_CATALOG = [
  "ae", "af", "al", "am", "ao", "ar", "at", "au", "aw", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bn", "bo", "bq", "br", "bs", "bt", "bw", "by", "bz", "ca", "cd", "cf", "cg", "ch", "ci", "cl", "cm", "cn", "co", "cr", "cu", "cw", "cy", "cz", "de", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "fi", "fj", "fk", "fr", "ga", "gb", "gd", "ge", "gf", "gh", "gl", "gm", "gn", "gq", "gr", "gt", "gu", "gw", "gy", "hn", "hr", "ht", "hu", "id", "ie", "il", "in", "iq", "ir", "is", "it", "jm", "jo", "jp", "ke", "kg", "kh", "kp", "kr", "kw", "kz", "la", "lb", "lc", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "md", "me", "mg", "mk", "ml", "mm", "mn", "mq", "mr", "mw", "mx", "my", "mz", "na", "nc", "ne", "ng", "ni", "nl", "no", "np", "nz", "om", "pa", "pe", "pg", "ph", "pk", "pl", "pr", "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sd", "se", "si", "sk", "sl", "sn", "so", "sr", "ss", "sv", "sy", "sz", "td", "tg", "th", "tj", "tl", "tm", "tn", "tr", "tt", "tw", "tz", "ua", "ug", "us", "uy", "uz", "vc", "ve", "vn", "vu", "xk", "ye", "yt", "za", "zm", "zw"
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
