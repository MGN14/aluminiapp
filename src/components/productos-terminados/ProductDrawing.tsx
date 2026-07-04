import { useMemo } from 'react';
import { buildProductDrawing, type ProductDrawingSpec } from '@/lib/productDrawing';

interface Props extends ProductDrawingSpec {
  className?: string;
}

/** Esquema SVG paramétrico del producto (escala con ancho×alto reales). */
export default function ProductDrawing({ className, ...spec }: Props) {
  const html = useMemo(
    () => buildProductDrawing(spec).svg,
    [spec.tipo, spec.naves, spec.apertura, spec.widthM, spec.heightM, spec.showDims],
  );
  return (
    <div
      className={`[&>svg]:w-full [&>svg]:h-full [&>svg]:max-h-full ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
