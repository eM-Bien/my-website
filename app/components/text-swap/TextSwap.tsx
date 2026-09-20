"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import s from "./TextSwap.module.scss";

/**
 * Czasy warstw – muszą zgadzać się z animacjami w SCSS. Sekwencja, nie
 * nakładanie: stary tekst rozwiewa się do końca (OUT_MS), dopiero potem
 * nowy się zbiera (IN_MS). Wejście jest więc opóźnione o OUT_MS.
 */
const OUT_MS = 550;
const IN_MS = 650;

/**
 * Siła "dymu": ile pikseli przemieszczenia i rozmycia na końcu wyjścia
 * (i na początku wejścia). Przemieszczenie robi falowanie krawędzi liter,
 * rozmycie – rozpływanie. Bez przemieszczenia to tylko rozmyty fade.
 */
const SMOKE = { displace: 90, blur: 16 };

/** Migawka HTML warstwy sprzed podmiany – to, co ma się rozwiać. */
type Held = { key: string; html: string };

/**
 * Podmiana dzieci "jak dym". React wymienia treść natychmiast, więc żeby
 * stary tekst mógł się rozpłynąć, trzeba go na moment PRZYTRZYMAĆ.
 *
 * Nie da się przytrzymać samych children: to nie jest statyczny tekst, tylko
 * element routera Nexta, który zawsze renderuje BIEŻĄCY segment – wstawiony
 * do warstwy wychodzącej pokazałby nowy tekst. Jedyne, co naprawdę jest
 * starym tekstem, to DOM sprzed podmiany. Więc w renderze, w którym zmienia
 * się segment (React nie zacommitował jeszcze nowych dzieci, DOM ma stare),
 * robimy migawkę innerHTML warstwy i wstawiamy ją jako martwy HTML do warstwy
 * wychodzącej. Nowe dzieci wchodzą w drugiej warstwie z opóźnieniem.
 *
 * Dwie techniki naraz, bo każda umie co innego:
 *  - CSS (keyframes): opacity, skalowanie, unoszenie – to CSS animuje sam.
 *  - filtr SVG (feTurbulence → feDisplacementMap → feGaussianBlur): falowanie
 *    i rozmycie. CSS nie umie interpolować url() w filter, więc atrybuty
 *    prymitywów ustawia pętla rAF, przez czas trwania podmiany.
 *
 * Warstwy są position:absolute na całą scenę, bo filter i transform tworzą
 * containing block – gdyby to był zwykły div, bloki tekstu (też absolute)
 * liczyłyby pozycję względem niego, a nie względem .stage.
 */
export default function TextSwap({ children }: { children: ReactNode }) {
  // NIE usePathname: ścieżka aktualizuje się render później niż dzieci, więc
  // nowy tekst renderował się od razu ostry, a potem – gdy ścieżka dogoniła –
  // był brany za "stary" i puszczany w dym. Segment [lang] pochodzi z tego
  // samego drzewa routera co dzieci i zmienia się razem z nimi.
  const pathname = useSelectedLayoutSegment() ?? "";
  const uid = useId();
  const outId = `smoke-out-${uid}`;
  const inId = `smoke-in-${uid}`;

  // Warstwa z bieżącą treścią – źródło migawki.
  const inLayer = useRef<HTMLDivElement | null>(null);

  // prev: warstwa wychodząca, żyje OUT_MS. entering: klasa i filtr wejścia,
  // żyją OUT_MS + IN_MS – wejście zaczyna się dopiero po wyjściu, więc nie
  // może zgasnąć razem z prev.
  const [swap, setSwap] = useState<{ key: string; prev: Held | null; entering: boolean }>({
    key: pathname,
    prev: null,
    entering: false,
  });

  // setState w trakcie renderu – dozwolone dla własnego komponentu: React
  // od razu renderuje ponownie, bez commitu pośredniego. Po tym key ===
  // pathname, więc nie zapętla się.
  // Odczyt DOM w renderze jest tu celowy: to jedyny moment, w którym DOM
  // ma jeszcze stary tekst, a my już wiemy, że nadchodzi nowy.
  if (swap.key !== pathname) {
    setSwap({
      key: pathname,
      prev: { key: swap.key, html: inLayer.current?.innerHTML ?? "" },
      entering: true,
    });
  }

  // Prymitywy filtrów – to ich atrybuty animuje pętla.
  const outDisp = useRef<SVGFEDisplacementMapElement | null>(null);
  const outBlur = useRef<SVGFEGaussianBlurElement | null>(null);
  const inDisp = useRef<SVGFEDisplacementMapElement | null>(null);
  const inBlur = useRef<SVGFEGaussianBlurElement | null>(null);

  useEffect(() => {
    if (!swap.entering) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const set = (
      disp: SVGFEDisplacementMapElement | null,
      blur: SVGFEGaussianBlurElement | null,
      k: number
    ) => {
      disp?.setAttribute("scale", String(reduce ? 0 : SMOKE.displace * k));
      blur?.setAttribute("stdDeviation", String(reduce ? 0 : SMOKE.blur * k));
    };

    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - t0;
      // wyjście przyspiesza (dym najpierw drga, potem szybko się rozwiewa),
      // wejście hamuje (zbiera się w ostry tekst na końcu)
      const outT = Math.min(t / OUT_MS, 1);
      const inT = Math.min(Math.max((t - OUT_MS) / IN_MS, 0), 1);   // start po wyjściu
      set(outDisp.current, outBlur.current, outT * outT);
      set(inDisp.current, inBlur.current, (1 - inT) * (1 - inT));
      if (t < OUT_MS + IN_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const clearOut = setTimeout(() => setSwap((v) => ({ ...v, prev: null })), OUT_MS);
    const clearIn = setTimeout(() => setSwap((v) => ({ ...v, entering: false })), OUT_MS + IN_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clearOut);
      clearTimeout(clearIn);
    };
    // klucz, nie prev: każda zmiana ścieżki to nowa sekwencja, także gdy
    // poprzednia jeszcze trwa (szybkie PL→EN→PL)
  }, [swap.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Filtry: szum o niskiej częstotliwości = duże, miękkie kłęby.
          Region powiększony, bo przemieszczenie wypycha piksele poza
          bounding box elementu i domyślny region by je ucinał. */}
      <svg aria-hidden="true" className={s.defs}>
        <defs>
          <filter id={outId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.011 0.017" numOctaves="2" seed="3" result="noise" />
            <feDisplacementMap ref={outDisp} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" result="warped" />
            <feGaussianBlur ref={outBlur} in="warped" stdDeviation="0" />
          </filter>
          <filter id={inId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.011 0.017" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap ref={inDisp} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" result="warped" />
            <feGaussianBlur ref={inBlur} in="warped" stdDeviation="0" />
          </filter>
        </defs>
      </svg>

      {swap.prev && (
        <div
          key={swap.prev.key}
          className={`${s.layer} ${s.out}`}
          style={{ filter: `url(#${outId})` }}
          aria-hidden="true"
          // martwy HTML: ma tylko wyglądać jak stary tekst przez OUT_MS
          dangerouslySetInnerHTML={{ __html: swap.prev.html }}
        />
      )}
      {/* key na ścieżce: nowa ścieżka = nowy element = animacja wejścia od
          zera. Bez prev (pierwsze wejście na stronę) nie animujemy i nie
          zakładamy filtra – teksty i tak są wtedy niewidoczne. */}
      <div
        key={swap.key}
        ref={inLayer}
        className={`${s.layer} ${swap.entering ? s.in : ""}`}
        style={swap.entering ? { filter: `url(#${inId})` } : undefined}
      >
        {children}
      </div>
    </>
  );
}
