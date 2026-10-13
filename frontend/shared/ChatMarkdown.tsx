"use client";

import { useMemo } from "react";
import { renderMarkdown } from "./markdownRenderer";

/**
 * Contenido de una respuesta de Geobot. Toda la conversión vive en `markdownRenderer` (AST + lista
 * blanca); este componente solo la memoiza. Las consultas del ciudadano NO pasan por aquí.
 */
export default function ChatMarkdown({ content }: { content: string }) {
  const nodes = useMemo(() => renderMarkdown(content), [content]);
  return <div className="markdown-content">{nodes}</div>;
}
