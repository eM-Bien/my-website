"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Oznacza element atrybutem data-in, gdy wjedzie w kadr. Sam nic nie
 * animuje – to robi CSS tego, kto go użyje ([data-in] { … }). Jeden
 * IntersectionObserver na element; po pierwszym wejściu przestaje
 * obserwować, bo wynurzenie ma się zdarzyć raz, nie przy każdym scrollu.
 */
export default function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** ms – rozjeżdża wejścia sąsiadów, żeby nie wynurzały się chórem */
  delay?: number;
  as?: "div" | "li" | "article" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.setAttribute("data-in", "");
        io.disconnect();
      },
      // dolna krawędź kadru przycięta: element ma być już kawałek w środku,
      // nie zaczynać animacji na samym brzegu
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={className}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
