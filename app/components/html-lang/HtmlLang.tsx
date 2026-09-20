"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { localeFromPath } from "@/app/locales";

/**
 * Ustawia <html lang>. Root layout nie zna języka (segment [lang] jest pod
 * nim, celowo – żeby scena przetrwała zmianę języka), więc atrybut poprawia
 * ten komponent po stronie klienta, ze ścieżki. W SSR strona ma lang
 * domyślny z root layoutu; poprawka wchodzi razem z hydracją.
 */
export default function HtmlLang() {
  const lang = localeFromPath(usePathname());
  useEffect(() => {
    if (lang) document.documentElement.lang = lang;
  }, [lang]);
  return null;
}
