/**
 * The key each Hangul letter sits on in the standard 2-set (두벌식) layout, as typed: lowercase for the plain key, the
 * uppercase letter for a shifted one (the doubled consonants and ㅒ ㅖ). A chord on a Korean keyboard names the
 * physical key, as herdr reads Ctrl on a non-Latin layout (#652).
 */
const TWO_SET: Readonly<Record<string, string>> = {
  ㅂ: "q",
  ㅈ: "w",
  ㄷ: "e",
  ㄱ: "r",
  ㅅ: "t",
  ㅛ: "y",
  ㅕ: "u",
  ㅑ: "i",
  ㅐ: "o",
  ㅔ: "p",
  ㅁ: "a",
  ㄴ: "s",
  ㅇ: "d",
  ㄹ: "f",
  ㅎ: "g",
  ㅗ: "h",
  ㅓ: "j",
  ㅏ: "k",
  ㅣ: "l",
  ㅋ: "z",
  ㅌ: "x",
  ㅊ: "c",
  ㅍ: "v",
  ㅠ: "b",
  ㅜ: "n",
  ㅡ: "m",
  ㅃ: "Q",
  ㅉ: "W",
  ㄸ: "E",
  ㄲ: "R",
  ㅆ: "T",
  ㅒ: "O",
  ㅖ: "P",
};

/** The Latin key under one Hangul letter, or undefined for anything else (a syllable, a word, a Latin letter). */
export function twoSetKey(data: string): string | undefined {
  return TWO_SET[data];
}
