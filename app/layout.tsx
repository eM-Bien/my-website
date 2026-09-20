import type { Metadata } from "next";
import { Cinzel_Decorative, Cormorant_Garamond, Inter, Montserrat } from "next/font/google";
import "./globals.scss";

/**
 * Cormorant Garamond – kruchy szeryf o dużym kontraście kresek. To on robi
 * baśniowy ton; w małych rozmiarach na ciemnym tle bywa zbyt cienki, więc
 * bierzemy też grubsze odmiany i używamy go głównie do dużego tekstu.
 */
const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"], // latin-ext = polskie ą, ę, ś, ż
  // 300 jest potrzebne: .title h1 w TreeScene.module.css go używa. Gdyby
  // zabrakło, przeglądarka podstawiłaby 400 i tytuł zrobiłby się cięższy.
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

/**
 * Cinzel Decorative – rzymskie kapitaliki z ozdobnymi zawijasami, tylko do
 * tytułu w scenie 3D. Nie ma odmiany 300; 400 to najlżejsza.
 */
const title = Cinzel_Decorative({
  variable: "--font-title",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
});

/**
 * Montserrat Black – ciężki geometryczny grotesk na podpisy przy drzewie.
 * Plakatowy kontrast z baśniowym tytułem jest celowy.
 */
// Bez listy weight: Montserrat jest fontem zmiennym, więc dostajemy całą oś
// 100–900 z jednego pliku. Potrzebne, bo blok końcowy ma akapit w 500.
const caption = Montserrat({
  variable: "--font-caption",
  subsets: ["latin", "latin-ext"],
});

/** Zapasowy bezszeryfowy do drobnego tekstu, gdzie Cormorant się rozmywa. */
const body = Inter({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "eM-Bien - portfolio",
  description: "Personal portfolio of eM-Bien, software engineer & designer",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${title.variable} ${caption.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
