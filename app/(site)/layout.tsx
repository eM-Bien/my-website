import HtmlLang from "@/app/components/html-lang/HtmlLang";
import LangSwitch from "@/app/components/lang-switch/LangSwitch";
import TextSwap from "@/app/components/text-swap/TextSwap";
import TreeScene from "@/app/components/tree/TreeScene";
import { fontVariables } from "@/app/fonts";
import "../globals.scss";

/**
 * Root layout strony. Scena WebGL siedzi TU, nad segmentem [lang] – dlatego
 * przełączenie /pl → /en jej nie przebudowuje: root layout zostaje
 * zamontowany, wymienia się tylko to, co [lang] renderuje jako children,
 * czyli same teksty. TextSwap robi z tej wymiany przenikanie z rozmyciem.
 *
 * Przełącznik i HtmlLang też są tu, a nie pod [lang]: inaczej przechodziłyby
 * przez TextSwap i przełącznik mrugałby podwójnie przy każdej zmianie.
 * Język czytają ze ścieżki. <html lang> ma wartość domyślną; właściwą
 * ustawia HtmlLang.
 */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={fontVariables}>
      <body>
        <HtmlLang />
        <LangSwitch />
        <main>
          <TreeScene fluid>
            <TextSwap>{children}</TextSwap>
          </TreeScene>
        </main>
      </body>
    </html>
  );
}
