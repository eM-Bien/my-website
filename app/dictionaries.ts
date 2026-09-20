import type { Locale } from "./locales";

export { locales, defaultLocale, hasLocale, type Locale } from "./locales";

/**
 * Słowniki ładowane dynamicznie: do bundla trafia tylko ten język, który jest
 * akurat renderowany, i to wyłącznie po stronie serwera. Do klienta idzie
 * gotowy HTML plus te stringi, które strona jawnie przekaże w propsach.
 *
 * Język przychodzi argumentem, nie z next/root-params: segment [lang] nie
 * jest nad root layoutem (scena musi być nad nim, żeby przetrwać zmianę
 * języka), więc nie jest parametrem korzenia.
 */
const dictionaries: Record<Locale, () => Promise<typeof import("./dictionaries/pl.json")>> = {
  pl: () => import("./dictionaries/pl.json").then((m) => m.default),
  en: () => import("./dictionaries/en.json").then((m) => m.default),
};

export const getDictionary = (locale: Locale) => dictionaries[locale]();

export type Dictionary = Awaited<ReturnType<typeof getDictionary>>;
