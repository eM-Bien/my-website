import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, hasLocale, locales } from "./app/locales";

/**
 * Wejście bez języka w ścieżce (np. "/") przekierowuje na "/pl" albo "/en" –
 * zależnie od Accept-Language przeglądarki. Ścieżki, które język już mają,
 * przechodzą bez zmian.
 */
function pickLocale(request: NextRequest): string {
  const header = request.headers.get("accept-language") ?? "";
  // "pl-PL,pl;q=0.9,en-US;q=0.8" → kolejno "pl-pl", "pl", "en-us";
  // bierzemy pierwszy, którego prefiks znamy
  for (const part of header.split(",")) {
    const base = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (hasLocale(base)) return base;
  }
  return defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const has = locales.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (has) return;

  request.nextUrl.pathname = `/${pickLocale(request)}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  // Pomijamy: wnętrzności Next, zasoby sceny i wszystko z rozszerzeniem
  // (favicon, obrazki, glb). Bez tego /scene/tree.glb leciałoby na
  // /pl/scene/tree.glb i drzewo by się nie wczytało.
  matcher: ["/((?!_next|scene|draco|.*\\..*).*)"],
};
