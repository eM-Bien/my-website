import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale, locales } from "@/app/dictionaries";

/** Obie wersje językowe renderują się statycznie przy buildzie. */
export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

/** Tytuł karty i opis zależą od języka – z tego samego słownika co treść. */
export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  return {
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: {
      languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])),
    },
  };
}

/**
 * Warstwa języka: tylko walidacja i metadata. Nie renderuje <html> ani
 * niczego stałego – to jest w root layoucie, żeby przetrwało zmianę języka.
 * Wszystko, co stąd wychodzi, przechodzi przez TextSwap.
 */
export default async function LangLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return children;
}
