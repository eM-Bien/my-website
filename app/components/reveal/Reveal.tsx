"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Pamięć wynurzeń na czas życia strony. Sekcje pod [lang] montują się od
 * nowa przy zmianie języka – bez tego każdy Reveal startowałby od zera
 * (niewidoczny → animacja), co przy tym samym obrazku wygląda jak podmiana.
 * Moduł żyje między nawigacjami, więc zbiór przeżywa remont komponentu.
 */
const revealed = new Set<string>();

/**
 * Oznacza element atrybutem data-in, gdy wjedzie w kadr. Sam nic nie
 * animuje – to robi CSS tego, kto go użyje ([data-in] { … }). Jeden
 * IntersectionObserver na element; po pierwszym wejściu przestaje
 * obserwować, bo wynurzenie ma się zdarzyć raz, nie przy każdym scrollu.
 *
 * Z `id` wynurzenie jest zapamiętane: po remoncie (np. zmiana języka)
 * element renderuje się od razu z data-in, bez powtórki animacji.
 */
export default function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  className?: string;
  /** ms – rozjeżdża wejścia sąsiadów, żeby nie wynurzały się chórem */
  delay?: number;
  as?: "div" | "li" | "article" | "section";
  /** stały identyfikator – włącza pamięć wynurzenia między remontami */
  id?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  // Odczyt w renderze jest bezpieczny: na serwerze i przy pierwszym
  // renderze klienta zbiór jest pusty, więc HTML się zgadza (bez data-in).
  const already = id !== undefined && revealed.has(id);

  useEffect(() => {
    const el = ref.current;
    if (!el || already) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.setAttribute("data-in", "");
        if (id !== undefined) revealed.add(id);
        io.disconnect();
      },
      // dolna krawędź kadru przycięta: element ma być już kawałek w środku,
      // nie zaczynać animacji na samym brzegu
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [already, id]);

  return (
    <Tag
      ref={ref as never}
      className={className}
      data-in={already ? "" : undefined}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
