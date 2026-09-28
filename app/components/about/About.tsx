import Reveal from "@/app/components/reveal/Reveal";
import type { Dictionary } from "@/app/dictionaries";
import s from "./About.module.scss";

type AboutData = Dictionary["about"];

/**
 * Jeden blok pod sceną, na tej samej wodzie (canvas jest fixed pod całą
 * stroną). Układ: po lewej duży, lekki nagłówek-zdanie, pod nim gwiazdka w
 * wąskiej kolumnie i wcięte akapity; po prawej grafika. Bez ramek – tekst
 * leży wprost na wodzie. Jedyny JS to Reveal (wejście w kadr).
 */
export default function About({ data }: { data: AboutData }) {
  return (
    <section id="o-mnie" className={s.section} aria-labelledby="about-heading">
      <Reveal id="about" className={s.inner}>
        <div className={`${s.text} swap-text`}>
          {/* \n w słowniku = łamanie linii ("Cześć," w osobnym wierszu) */}
          <h2 id="about-heading" className="tb-heading">
            {data.statement.split("\n").map((line, i) => (
              <span key={i} className={s.line}>
                {line}
              </span>
            ))}
          </h2>

          <div className="tb-note">
            <span className="tb-mark" aria-hidden="true">
              *
            </span>
            <div className="tb-body">
              {data.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>
        </div>

        {/* Miejsce na grafikę – na razie gradient */}
        <div className={s.figure} aria-hidden="true" />
      </Reveal>
      <span className="sr-only">{data.label}</span>
    </section>
  );
}
