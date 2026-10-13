/**
 * Cableado de producción del chat: Qdrant/worker de recuperación, PostgreSQL (contactos,
 * conversaciones, registro), Bedrock y el estado operativo. Todo lo demás es inyectable.
 */
import { evidenciaVigente } from "../services/manifest.js";
import { operations } from "../admin/operations.js";
import { readContactSnapshot } from "../admin/contacts.js";
import { bedrockAdapter } from "../bedrock/askBedrock.js";
import { linkDocumentCodes, loadDocumentCodeIndex } from "../services/documentLinks.js";
import { search } from "../services/retrievalClient.js";
import type { ChatDeps } from "./handleChat.js";
import { chatPool } from "./db.js";
import { loadConversation, saveClarification } from "./conversations.js";
import { onModelEvent } from "./modelRouting.js";
import { saveAnonymousUsage, saveInteraction } from "./records.js";
import { describeEpisode, writeEpisodes } from "./registryEpisode.js";
import { serviceEvents } from "../admin/serviceEvents.js";
import { setUnavailableSink } from "./unavailable.js";

const MODEL_COMPONENT: Record<string, "gpt-oss-20b" | "gpt-oss-120b"> = {
  "openai.gpt-oss-20b-1:0": "gpt-oss-20b",
  "openai.gpt-oss-120b-1:0": "gpt-oss-120b",
};

let wired = false;

/** Cada intento real a un modelo actualiza su estado observado y abre un aviso si falló. */
export function wireOperationalEvents(): void {
  if (wired) return;
  wired = true;
  // Indisponibilidad (modelos, búsqueda, plazo): evento técnico mínimo + aviso agrupado del panel.
  // Ningún texto ni identificador; la base operativa caída no retrasa la respuesta de error.
  setUnavailableSink((component, mode) => {
    serviceEvents.record(component, mode);
    const descripcion = component === "modelos" ? "El servicio no pudo atender consultas por el modelo."
      : component === "busqueda" ? "La búsqueda documental no estuvo disponible para atender una consulta."
      : "Una consulta no pudo completarse dentro del plazo de 40 segundos.";
    void operations.notify("modelo_no_disponible", "componente", component === "modelos" ? "servicio-modelos" : component, descripcion);
  });
  onModelEvent(e => {
    const c = MODEL_COMPONENT[e.modelId];
    if (!c) return;
    void operations.reportComponent(c, e.ok, e.ok ? {} : { reason: `fallo: ${e.kind ?? "desconocido"}` });
    if (!e.ok) void operations.notify("modelo_no_disponible", "componente", c, `El modelo ${c} falló al atender una consulta.`);
  });
}

export function productionDeps(): ChatDeps {
  wireOperationalEvents();
  let adapter: ReturnType<typeof bedrockAdapter> | undefined;
  return {
    contacts: budget => readContactSnapshot(chatPool(), budget),
    retrieve: async (pregunta, cola) => {
      const r = await search(pregunta, cola);
      // Reranker caído: la consulta continúa con los mejores de RRF; el panel lo ve degradado (RF-C3-DI-06).
      if (r.degraded) {
        void operations.reportComponent("reranker", true, { degraded: true, thresholdApplied: false, reason: "reranker no disponible: se usan los mejores de RRF sin umbral" });
        void operations.notify("reranker_degradado", "componente", "reranker", "El reranker no estuvo disponible; se respondió con los mejores resultados de RRF sin umbral.");
      } else {
        void operations.reportComponent("reranker", true, { thresholdApplied: r.thresholdApplied });
      }
      return { hits: r.hits };
    },
    revalidate: hits => evidenciaVigente(hits),
    get adapter() { return (adapter ??= bedrockAdapter()); },
    loadConversation: (id, sub, budget) => loadConversation(id, sub, chatPool(), budget),
    saveClarification: (id, pending, budget) => saveClarification(id, pending, chatPool(), new Date(), budget),
    saveInteraction: (rec, hooks, budget) => saveInteraction(rec, hooks, chatPool(), budget),
    saveAnonymousUsage: (rec, hooks, budget) => saveAnonymousUsage(rec, hooks, chatPool(), budget),
    linkCodes: async text => {
      try { return linkDocumentCodes(text, await loadDocumentCodeIndex()); } catch { return text; }
    },
    onModelsUnavailable: () => {
      void operations.notify("doble_fallo_modelos", "componente", "modelos", "Ambos modelos fallaron para una misma consulta.");
    },
    // Primer fallo de un episodio: estado degradado y UN aviso con fecha, hora y modo. El objeto del
    // aviso es la identidad operativa del episodio: otro episodio abre otro aviso aunque este siga
    // sin revisar, y revisar el aviso no implica que el servicio se haya recuperado.
    onRegistryFailureEpisode: episode => {
      void operations.reportComponent("registro", false, { reason: "escritura del registro fallida" });
      void operations.notify("registro_no_disponible", "componente", `registro:${episode.episodeId}`, describeEpisode(episode))
        .then(() => writeEpisodes.markPersisted(episode.episodeId));
    },
    // Primer éxito (del proceso o tras un episodio): el estado observado vuelve a normal.
    onRegistryNormal: () => { void operations.reportComponent("registro", true); },
  };
}
