import type { ReactNode } from "react";
import s from "./TreeScene.module.css";

/**
 * Teksty nad sceną. Same nie wiedzą, kiedy są widoczne – czytają zmienne
 * CSS, które pętla renderująca TreeScene ustawia na sekcji co klatkę
 * (--cap-0, --copy, --tail i ich odpowiedniki -y). Dzięki temu treść może
 * przyjść z serwera i wymienić się przy zmianie języka, a scena – która
 * trzyma timing – zostaje nietknięta.
 *
 * Wartości domyślne w var() to stan "przed wczytaniem sceny": niewidoczny,
 * lekko obniżony.
 */
const fade = (name: string, restPx: number) => ({
  opacity: `var(${name}, 0)`,
  transform: `translateY(var(${name}-y, ${restPx}px))`,
});

/** Podpis przy drzewie. Parzyste indeksy po lewej, nieparzyste po prawej. */
export function SceneCaption({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div
      className={`${s.caption} ${index % 2 === 0 ? s.captionLeft : s.captionRight}`}
      style={fade(`--cap-${index}`, 20)}
    >
      <p>{children}</p>
    </div>
  );
}

/** Blok po przekadrowaniu drzewa w prawo. */
export function SceneCopy({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className={s.copy} style={fade("--copy", 24)}>
      <h2>{heading}</h2>
      <p>{children}</p>
    </div>
  );
}

/** Blok przy zbliżeniu na płatki – to samo miejsce co SceneCopy, po nim. */
export function SceneTailCopy({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className={s.copy} style={fade("--tail", 24)}>
      <h2>{heading}</h2>
      <p>{children}</p>
    </div>
  );
}
