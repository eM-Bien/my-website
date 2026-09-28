import { notFound } from "next/navigation";
import { SceneCaption, SceneCopy } from "@/app/components/tree/SceneText";
import { getDictionary, hasLocale, locales } from "@/app/dictionaries";

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

/**
 * Slot @scene: to, co ląduje WEWNĄTRZ sceny, nad canvasem. Osobna "strona"
 * niż children, bo layout musi wstawić teksty do TreeScene, a resztę
 * (sekcje pod sceną) obok niej – jedna strona nie ma jak trafić w dwa
 * miejsca. Oba sloty są pod [lang], więc oba podmieniają się z językiem.
 */
export default async function ScenePage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { scene } = await getDictionary(lang);

  return (
    <>
      {/* Tytuł widoczny jest obiektem w scenie WebGL. Ten h1 jest tylko dla
          czytników ekranu i wyszukiwarek – canvas jest dla nich pusty. */}
      <h1 className="sr-only">{scene.title}</h1>

      {scene.captions.map((text, i) => (
        <SceneCaption key={i} index={i}>
          {text}
        </SceneCaption>
      ))}

      <SceneCopy heading={scene.copy.heading}>{scene.copy.body}</SceneCopy>
    </>
  );
}
