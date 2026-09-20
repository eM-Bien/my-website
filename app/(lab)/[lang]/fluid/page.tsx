import { notFound } from "next/navigation";
import TreeScene from "@/app/components/tree/TreeScene";
import { SceneCaption, SceneCopy, SceneTailCopy } from "@/app/components/tree/SceneText";
import { getDictionary, hasLocale, locales } from "@/app/dictionaries";

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

/** Poligon: to samo co strona główna – zostaje do porównań ze /tree. */
export default async function FluidPage({ params }: PageProps<"/[lang]/fluid">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { scene } = await getDictionary(lang);

  return (
    <main>
      <TreeScene fluid>
        {scene.captions.map((text, i) => (
          <SceneCaption key={i} index={i}>
            {text}
          </SceneCaption>
        ))}
        <SceneCopy heading={scene.copy.heading}>{scene.copy.body}</SceneCopy>
        <SceneTailCopy heading={scene.tail.heading}>{scene.tail.body}</SceneTailCopy>
      </TreeScene>
    </main>
  );
}
