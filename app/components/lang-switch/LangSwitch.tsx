"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { localeFromPath, locales } from "@/app/locales";
import s from "./LangSwitch.module.scss";

/**
 * Przełącznik języka. Siedzi w root layoucie – nad segmentem [lang] – więc
 * nie przechodzi przez animację podmiany tekstów. Bieżący język czyta ze
 * ścieżki, bo root layout go nie zna.
 *
 * scroll={false}: Next domyślnie przewija do góry po nawigacji. Scena liczy
 * progress ze scrolla – skok na górę cofnąłby kamerę na start.
 */
export default function LangSwitch() {
  const current = localeFromPath(usePathname());
  return (
    <nav className={s.switch} aria-label="Język / Language">
      {locales.map((l) => (
        <Link
          key={l}
          href={`/${l}`}
          scroll={false}
          hrefLang={l}
          lang={l}
          aria-current={l === current ? "page" : undefined}
          className={s.link}
        >
          {l.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}
