import { notFound } from "next/navigation";
import About from "@/app/components/about/About";
import { getDictionary, hasLocale } from "@/app/dictionaries";

/**
 * Slot children: sekcje POD sceną. Teksty do wnętrza sceny są w @scene.
 */
export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { about } = await getDictionary(lang);

  return <About data={about} />;
}
