import { fontVariables } from "@/app/fonts";
import "../globals.scss";

/**
 * Drugi root layout – dla poligonów /tree i /fluid. Nie owija dzieci sceną,
 * bo każdy poligon montuje TreeScene sam, z własnymi ustawieniami. Przejście
 * między (site) a (lab) to pełne przeładowanie strony – dla stron testowych
 * to bez znaczenia.
 */
export default function LabLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
