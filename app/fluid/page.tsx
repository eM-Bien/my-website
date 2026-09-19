import TreeScene from '@/app/components/tree/TreeScene';

/**
 * Poligon dla smugi za kursorem. Ta sama scena co na /tree, tylko z
 * postprocessingiem – żeby dało się porównać obie wersje obok siebie
 * bez dublowania komponentu.
 */
export default function FluidPage() {
  return (
    <main>
      <TreeScene fluid />
    </main>
  );
}
