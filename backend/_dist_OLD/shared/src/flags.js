export const FULL_FLAG_CATALOG = [
    "ae", "af", "ag", "ai", "al", "am", "ao", "ar", "as", "at", "au", "aw", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bl", "bm", "bn", "bo", "bq", "br", "bs", "bt", "bw", "by", "bz", "ca", "cd", "cf", "cg", "ch", "ci", "cl", "cm", "cn", "co", "cr", "cu", "cv", "cw", "cy", "cz", "de", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gb", "gd", "ge", "gf", "gh", "gl", "gm", "gn", "gp", "gq", "gr", "gt", "gu", "gw", "gy", "hn", "hr", "ht", "hu", "id", "ie", "il", "in", "iq", "ir", "is", "it", "jm", "jo", "jp", "ke", "kg", "kh", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "md", "me", "mf", "mg", "mh", "mk", "ml", "mm", "mn", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz", "na", "nc", "ne", "ng", "ni", "nl", "no", "np", "nr", "nz", "om", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pr", "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd", "se", "si", "sk", "sl", "sn", "so", "sr", "ss", "st", "sv", "sx", "sy", "sz", "tc", "td", "tg", "th", "tj", "tl", "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "us", "uy", "uz", "vc", "ve", "vg", "vi", "vn", "vu", "ws", "xk", "ye", "yt", "za", "zm", "zw"
];
export const ROOM_DIFFICULTIES = ["easy", "medium", "hard", "007"];
export const DIFFICULTY_FLAG_COUNTS = {
    easy: 24,
    medium: 36,
    hard: 48
};
export function getDifficultyFlagCount(difficulty, fullCatalogCount = FULL_FLAG_CATALOG.length) {
    if (difficulty === "007") {
        return fullCatalogCount;
    }
    return DIFFICULTY_FLAG_COUNTS[difficulty];
}
