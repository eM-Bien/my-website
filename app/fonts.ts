import { Cinzel_Decorative, Cormorant_Garamond, Inter, Montserrat } from "next/font/google";

/**
 * Fonty w jednym miejscu, bo root layouty są dwa – (site) i (lab) – i oba
 * muszą wystawić te same zmienne CSS. next/font wymaga wywołania na poziomie
 * modułu, więc to nie może być funkcja.
 */

/** Cormorant Garamond – kruchy szeryf; został na body. */
const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"], // latin-ext = polskie ą, ę, ś, ż
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

/** Cinzel Decorative – tylko tytuł w scenie 3D. Nie ma odmiany 300. */
const title = Cinzel_Decorative({
  variable: "--font-title",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
});

/** Montserrat – podpisy i bloki tekstu. Font zmienny, cała oś 100–900. */
const caption = Montserrat({
  variable: "--font-caption",
  subsets: ["latin", "latin-ext"],
});

/** Zapasowy bezszeryfowy do drobnego tekstu. */
const body = Inter({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
});

/** Do className na <html>. */
export const fontVariables = [display, title, caption, body]
  .map((f) => f.variable)
  .join(" ");
