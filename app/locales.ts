/**
 * Lista języków w jednym, czystym module – bez importów Nexta i bez
 * słowników. Dzięki temu może go użyć wszystko: proxy (runtime edge),
 * komponenty klienckie (przełącznik) i serwer (słowniki).
 */
export const locales = ["pl", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pl";

export const hasLocale = (value: string): value is Locale =>
  (locales as readonly string[]).includes(value);

/** "/en/cokolwiek" → "en"; ścieżka bez znanego języka → null. */
export const localeFromPath = (pathname: string): Locale | null => {
  const first = pathname.split("/")[1] ?? "";
  return hasLocale(first) ? first : null;
};
