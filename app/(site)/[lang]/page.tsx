import { notFound } from "next/navigation";
import { SceneCaption, SceneCopy, SceneTailCopy } from "@/app/components/tree/SceneText";
import { getDictionary, hasLocale } from "@/app/dictionaries";

/**
 * Strona renderuje WYŁĄCZNIE teksty. Scena jest w root layoucie i dostaje je
 * jako children – to one się wymieniają przy zmianie języka, scena nie.
 * Kiedy który tekst jest widoczny, decyduje pętla sceny przez zmienne CSS
 * na sekcji; te komponenty tylko je czytają.
 */
export default async function Home({ params }: PageProps<"/[lang]">) {
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
      <SceneTailCopy heading={scene.tail.heading}>{scene.tail.body}</SceneTailCopy>
    </>
  );
}
