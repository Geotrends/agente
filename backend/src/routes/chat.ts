import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getDocumentsRootPath,
  listCourseDocuments,
  listFolderEntries,
  listTopLevelFolders,
  readDocumentContent,
  safeResolveUnderRoot
} from "../services/context.js";
import { hybridSearch, retrievalStatus } from "../services/search.js";
import { askSmartTutor, askTutor, type LlmProvider } from "../services/llm.js";
import { normalizeHistory } from "../shared/chatHistory.js";
import { isProviderConfigured } from "../services/providerRouter.js";

type ChatBody = {
  message: string;
  courseId: string;
  documentId?: string;
  lessonId?: string;
  provider?: LlmProvider;
  folder?: string;
  autoRoute?: boolean;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

const router = Router();
router.get("/retrieval/status", (_req, res) => res.json(retrievalStatus));
router.get("/providers", (_req, res) => res.json({ providers:
  (["ollama", "gemini", "groq", "deepseek"] as const).map(id => ({ id, configured: isProviderConfigured(id) }))
}));

router.post("/chat", async (req, res) => {
  try {
    const { message, documentId, lessonId, provider, folder, autoRoute, history } =
      req.body as Partial<ChatBody>;
    if (typeof message !== "string" || !message.trim() || message.length > 12000) {
      res.status(400).json({ error: "Envía una pregunta de entre 1 y 12000 caracteres." });
      return;
    }
    if (provider && !["auto", "gemini", "groq", "deepseek", "ollama"].includes(provider)) {
      res.status(400).json({ error: "Proveedor no válido." }); return;
    }
    if ([folder, documentId, lessonId].some(v => v !== undefined && typeof v !== "string")) {
      res.status(400).json({ error: "Carpeta y documento deben ser texto." }); return;
    }
    const folderPrefix = folder?.trim() || undefined;
    const selected = documentId || lessonId;
    const resolvedDocumentId = selected && selected !== "__geotrends_no_doc__" ? selected : undefined;
    const chatHistory = normalizeHistory(history);
    const useAutoRoute = autoRoute === true || !provider || provider === "auto";
    const previousQuestion = [...chatHistory].reverse().find(t => t.role === "user")?.content;
    const query = previousQuestion && message.length < 160
      ? `${previousQuestion.slice(-500)}\n${message}` : message;
    const retrieval = await hybridSearch(query, folderPrefix, resolvedDocumentId);
    const courseContext = retrieval.hits.map(h =>
      `--- Fuente: ${h.path} · fragmento ${h.chunk} ---\n${h.snippet}`
    ).join("\n\n");
    const tutorPayload = { message, courseContext, history: chatHistory };

    let answer: string;
    let resolvedProvider: string;
    let routingReason: string | null = null;

    if (useAutoRoute) {
      const smart = await askSmartTutor(tutorPayload);
      answer = smart.answer;
      resolvedProvider = smart.provider;
      routingReason = smart.routingReason;
    } else {
      answer = await askTutor({ ...tutorPayload, provider: provider || "gemini" });
      resolvedProvider = provider || "gemini";
    }

    res.json({ answer, meta: {
      provider: resolvedProvider,
      providerLabel: resolvedProvider,
      routingReason,
      autoRoute: useAutoRoute,
      contextChars: courseContext.length,
      retrieval: { method: retrieval.method, documents: retrieval.documents, chunks: retrieval.chunks },
      sources: retrieval.hits.map(({ snippet, ...source }) => source)
    } });
  } catch (error) {
    console.error("[chat]", error);
    res.status(503).json({ error: "No se pudo completar la consulta. Revisa el estado del índice y la conexión del backend." });
  }
});

router.get("/documents", async (req, res) => {
  const courseId = String(req.query.courseId || "");
  if (!courseId) {
    res.status(400).json({
      error: "Debes enviar courseId como query param."
    });
    return;
  }

  const rawFolder = typeof req.query.folder === "string" ? req.query.folder : "";
  const folder = rawFolder.trim() || undefined;

  const documents = await listCourseDocuments(courseId, folder);
  res.json({
    courseId,
    folder: folder || null,
    documents
  });
});

router.get("/folders", async (req, res) => {
  const rawParent = typeof req.query.parent === "string" ? req.query.parent.trim() : "";
  const parent = rawParent || undefined;
  if (!parent) {
    const folders = await listTopLevelFolders();
    res.json({ folders, parent: null });
    return;
  }
  const entries = await listFolderEntries(parent);
  res.json({
    folders: entries.filter((e) => e.kind === "directory").map((e) => e.name),
    entries,
    parent
  });
});

router.get("/document", async (req, res) => {
  const rawPath = String(req.query.path || "").trim();
  if (!rawPath) {
    res.status(400).json({ error: "Debes enviar path como query param." });
    return;
  }

  const root = getDocumentsRootPath();
  const fullPath = safeResolveUnderRoot(root, rawPath);
  if (!fullPath) {
    res.status(400).json({ error: "Ruta de documento invalida." });
    return;
  }

  try {
    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : ext === ".xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : ext === ".md" || ext === ".txt"
              ? "text/plain; charset=utf-8"
              : "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch {
    res.status(404).json({ error: "No se encontro el documento." });
  }
});

/** Texto extraido para vista previa de docx, txt, md, xlsx (no PDF). */
router.get("/document/text", async (req, res) => {
  const rawPath = String(req.query.path || "").trim();
  if (!rawPath) {
    res.status(400).json({ error: "Debes enviar path como query param." });
    return;
  }

  const root = getDocumentsRootPath();
  const fullPath = safeResolveUnderRoot(root, rawPath);
  if (!fullPath) {
    res.status(400).json({ error: "Ruta de documento invalida." });
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  if (ext === ".pdf") {
    res.status(400).json({ error: "Para PDF usa /document con iframe." });
    return;
  }

  try {
    const text = await readDocumentContent(fullPath);
    const maxChars = 80_000;
    const truncated = text.length > maxChars;
    res.json({
      path: rawPath,
      extension: ext,
      text: truncated ? text.slice(0, maxChars) : text,
      truncated
    });
  } catch {
    res.status(404).json({ error: "No se pudo leer el documento." });
  }
});

/** HTML para vista previa (xlsx como tabla). */
router.get("/document/html", async (req, res) => {
  const rawPath = String(req.query.path || "").trim();
  if (!rawPath) {
    res.status(400).json({ error: "Debes enviar path como query param." });
    return;
  }

  const root = getDocumentsRootPath();
  const fullPath = safeResolveUnderRoot(root, rawPath);
  if (!fullPath) {
    res.status(400).json({ error: "Ruta de documento invalida." });
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  if (ext !== ".xlsx") {
    res.status(400).json({ error: "Solo xlsx usa /document/html." });
    return;
  }

  try {
    const buffer = await fs.readFile(fullPath);
    const { default: XLSX } = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const tableHtml = XLSX.utils.sheet_to_html(sheet, { id: `sheet-${sheetName}` });
      parts.push(`<section class="xlsx-sheet"><h2>${sheetName}</h2>${tableHtml}</section>`);
    }
    res.json({ path: rawPath, extension: ext, html: parts.join("") || "<p>(Hoja vacia)</p>" });
  } catch {
    res.status(404).json({ error: "No se pudo leer el documento." });
  }
});

export default router;
