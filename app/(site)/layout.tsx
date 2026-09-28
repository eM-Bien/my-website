import HtmlLang from "@/app/components/html-lang/HtmlLang";
import LangSwitch from "@/app/components/lang-switch/LangSwitch";
import TextSwap from "@/app/components/text-swap/TextSwap";
import TreeScene from "@/app/components/tree/TreeScene";
import { fontVariables } from "@/app/fonts";
import "../globals.scss";

/**
 * Root layout strony. Scena WebGL siedzi TU, nad segmentem [lang] – dlatego
 * przełączenie /pl → /en jej nie przebudowuje: root layout zostaje
 * zamontowany, wymienia się tylko to, co [lang] renderuje.
 *
 * Dwa sloty (parallel routes):
 *  - scene    → @scene/[lang]/page.tsx: teksty do WNĘTRZA sceny, przez
 *               TextSwap (dym przy zmianie języka)
 *  - children → [lang]/page.tsx: sekcje POD sceną
 *
 * Przełącznik i HtmlLang też są tu, a nie pod [lang]: inaczej przechodziłyby
 * przez TextSwap i przełącznik mrugałby podwójnie przy każdej zmianie.
 */
export default function SiteLayout({ children, scene }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={fontVariables}>
      <body>
        <HtmlLang />
        <LangSwitch />
        <main>
          <TreeScene fluid>
            <TextSwap>{scene}</TextSwap>
          </TreeScene>
          {/* Sekcje pod sceną dostają ten sam dym przy zmianie języka, tylko
              w trybie przepływu – warstwy nie są przypięte do sceny. */}
          <TextSwap layout="flow">{children}</TextSwap>
        </main>
      </body>
    </html>
  );
}
