"use client";

import { useEffect, useRef, useState } from "react";
import ChatMarkdown from "./ChatMarkdown";
import {
  AGENT_DOCUMENT_FILE_URL,
  AGENT_DOCUMENT_HTML_URL,
  AGENT_DOCUMENT_TEXT_URL,
} from "./agentConfig";

type Props = {
  documentPath: string;
};

type PreviewKind = "pdf" | "docx" | "md" | "txt" | "xlsx" | "xls" | "unknown";

function getPreviewKind(path: string): PreviewKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  return "unknown";
}

function textToParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function DocumentPreview({ documentPath }: Props) {
  const docxHostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [textContent, setTextContent] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [truncated, setTruncated] = useState(false);

  const kind = getPreviewKind(documentPath);
  const fileName = documentPath.split("/").pop() ?? documentPath;
  const fileUrl = `${AGENT_DOCUMENT_FILE_URL}?path=${encodeURIComponent(documentPath)}`;

  useEffect(() => {
    setError("");
    setTextContent("");
    setHtmlContent("");
    setTruncated(false);

    if (!documentPath || kind === "pdf") return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        if (kind === "docx") {
          const host = docxHostRef.current;
          if (!host) return;

          host.innerHTML = "";
          const response = await fetch(fileUrl);
          if (!response.ok) throw new Error("No se pudo cargar el documento.");
          const blob = await response.blob();
          if (cancelled) return;

          const { renderAsync } = await import("docx-preview");
          await renderAsync(blob, host, undefined, {
            className: "docx-preview-render",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            useBase64URL: true,
          });
          return;
        }

        if (kind === "xlsx" || kind === "xls") {
          const response = await fetch(
            `${AGENT_DOCUMENT_HTML_URL}?path=${encodeURIComponent(documentPath)}`,
          );
          const data = (await response.json()) as {
            html?: string;
            error?: string;
          };
          if (cancelled) return;
          if (!response.ok)
            throw new Error(data.error || "No se pudo cargar la hoja.");
          setHtmlContent(data.html || "<p>(Hoja vacia)</p>");
          return;
        }

        const response = await fetch(
          `${AGENT_DOCUMENT_TEXT_URL}?path=${encodeURIComponent(documentPath)}`,
        );
        const data = (await response.json()) as {
          text?: string;
          truncated?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok)
          throw new Error(data.error || "No se pudo cargar la vista previa.");
        setTextContent(
          data.text?.trim() || "(Documento sin contenido legible.)",
        );
        setTruncated(Boolean(data.truncated));
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Error al cargar la vista previa.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (docxHostRef.current) docxHostRef.current.innerHTML = "";
    };
  }, [documentPath, fileUrl, kind]);

  const previewUrl = `${fileUrl}#zoom=page-width`;

  return (
    <div className="doc-preview">
      <p className="doc-preview-title">Vista previa: {fileName}</p>
      <div className="doc-preview-resizable">
        {kind === "pdf" ? (
          <iframe
            title={`Vista previa de ${fileName}`}
            src={previewUrl}
            className="doc-preview-frame"
          />
        ) : (
          <div className="doc-preview-word-shell">
            {loading && (
              <p className="doc-preview-status">Cargando vista previa...</p>
            )}
            {error && (
              <p className="doc-preview-status doc-preview-error">{error}</p>
            )}

            {kind === "docx" && (
              <div ref={docxHostRef} className="doc-preview-docx-host" />
            )}

            {!loading && !error && kind === "md" && (
              <article className="doc-preview-page doc-preview-prose">
                {truncated && (
                  <p className="doc-preview-truncated">
                    Vista previa recortada (documento muy largo).
                  </p>
                )}
                <ChatMarkdown content={textContent} />
              </article>
            )}

            {!loading && !error && kind === "txt" && (
              <article className="doc-preview-page doc-preview-prose">
                {truncated && (
                  <p className="doc-preview-truncated">
                    Vista previa recortada (documento muy largo).
                  </p>
                )}
                {textToParagraphs(textContent).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </article>
            )}

            {!loading && !error && (kind === "xlsx" || kind === "xls") && (
              <article
                className="doc-preview-page doc-preview-spreadsheet"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            )}

            {!loading && !error && kind === "unknown" && (
              <article className="doc-preview-page doc-preview-prose">
                <p>
                  {textContent || "Formato no soportado para vista previa."}
                </p>
              </article>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
