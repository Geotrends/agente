/**
 * Ejecución completa de la matriz: arma dependencias, corre, y escribe el paquete de evidencia
 * (manifiesto con identidad, resultados por caso, informe y consumo). Separado del CLI para poder
 * probarlo con el adaptador doble.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ModelAdapter } from "../../src/chat/contracts.js";
import type { ChatDeps } from "../../src/chat/handleChat.js";
import { PROMPT_VERSION } from "../../src/prompts/tutorPrompt.js";
import { TOKENIZER_PIN } from "../../src/chat/outputTokenizer.js";
import { runtimeVersions } from "../../src/services/calibration.js";
import { MATRIX, matrixHash, runMatrix, summarize, type CaseResult } from "./diAcceptance.js";

export type EvidenceInput = {
  outDir: string;
  adapterLabel: "double" | "aws";
  models: "both" | "20b" | "120b";
  adapter: ModelAdapter;
  deps: Omit<ChatDeps, "adapter">;
  newConversation: () => Promise<string>;
  /** Identidad que sale del entorno de ejecución (corpus, contactos, tarifas, región). */
  environment: Record<string, string | number | null>;
  responsable: string | null;
  runDelegated?: boolean;
  forceCutTokens?: number;
  only?: string[];
  /** Consulta de consumo registrada (ADMIN_DATABASE_URL); opcional. */
  consumption?: () => Promise<unknown>;
};

function git(args: string[]): string {
  try { return execFileSync("git", args, { encoding: "utf8", cwd: path.resolve(process.cwd(), "..") }).trim(); } catch { return "desconocido"; }
}

export type Identity = { fecha: string; git: string; hashCambiosLocales: string; matrizHash: string; prompt: string } & Record<string, unknown>;

export function identity(extra: Record<string, string | number | null>): Identity {
  const diff = git(["diff", "HEAD"]);
  const v = runtimeVersions();
  return {
    fecha: new Date().toISOString(),
    git: git(["rev-parse", "HEAD"]),
    hashCambiosLocales: createHash("sha256").update(diff).digest("hex"),
    prompt: PROMPT_VERSION,
    tokenizador: TOKENIZER_PIN,
    embedding: v.embedding, reranker: v.reranker, politicaSeleccion: v.politica,
    matrizHash: matrixHash(),
    ...extra,
  };
}

export async function produceEvidence(input: EvidenceInput): Promise<{ results: CaseResult[]; summary: ReturnType<typeof summarize>; delegated: Array<{ criterio: string; comando: string; exit: number | null }> }> {
  await fs.mkdir(input.outDir, { recursive: true });
  const results = await runMatrix({
    adapter: input.adapter, adapterLabel: input.adapterLabel, models: input.models, deps: input.deps,
    newConversation: input.newConversation, only: input.only, forceCutTokens: input.forceCutTokens,
  });
  const summary = summarize(results);

  const delegated: Array<{ criterio: string; comando: string; exit: number | null }> = [];
  if (input.runDelegated) {
    for (const c of MATRIX.filter(m => m.delegadaA?.startsWith("node --import tsx --test"))) {
      const files = c.delegadaA!.replace(/\(.*$/, "").trim().split(/\s+/).slice(4);
      const r = spawnSync("node", ["--import", "tsx", "--test", "--test-concurrency=1", ...files], { encoding: "utf8" });
      delegated.push({ criterio: c.id, comando: c.delegadaA!, exit: r.status });
    }
  }

  const manifest = {
    ...identity(input.environment),
    adapter: input.adapterLabel,
    modelos: input.models,
    responsableFuncional: input.responsable,
    firmaRevisionFuncional: null,
    aceptacionReal: input.adapterLabel === "aws" ? "pendiente de revisión funcional y de los runners delegados" : "NO: adapter=double no cuenta como aceptación de AWS",
  };
  await fs.writeFile(path.join(input.outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await fs.writeFile(path.join(input.outDir, "results.json"), JSON.stringify({ summary, delegated, results }, null, 2) + "\n");
  if (input.consumption) {
    try { await fs.writeFile(path.join(input.outDir, "consumo.json"), JSON.stringify(await input.consumption(), null, 2) + "\n"); } catch { /* sin acceso a la BD de consumo */ }
  }

  const fallos = results.filter(r => r.pass === false);
  const lines = [
    `# Informe de la matriz DI`, "",
    `- **Adaptador**: \`${input.adapterLabel}\`${input.adapterLabel === "double" ? " — **no cuenta como aceptación de AWS**" : ""}`,
    `- **Casos**: ${summary.total} · automáticos aprobados ${summary.aprobados} · **fallos ${summary.fallados}** · pendientes de revisión/otro runner ${summary.pendientesManual}`,
    `- **Git**: \`${manifest.git.slice(0, 12)}\` · cambios locales \`${manifest.hashCambiosLocales.slice(0, 12)}\` · matriz \`${manifest.matrizHash.slice(0, 12)}\``, "",
    `| Criterio | Requisito | OK | Fallo | Pendiente |`, `|---|---|---|---|---|`,
    ...MATRIX.map(c => { const e = summary.porCriterio[c.id] ?? { ok: 0, fail: 0, manual: 0 }; return `| ${c.id} | ${c.requisito} | ${e.ok} | ${e.fail} | ${e.manual} |`; }), "",
    fallos.length ? `## Fallos (clasificados; la prioridad contractual original se conserva)\n\n${fallos.map(f => `- **${f.criterio}** · ${f.caso} · ${f.failure ?? "?"}: ${f.observado}`).join("\n")}` : "## Sin fallos automáticos", "",
    "## Pendiente de firma", "", "Los criterios con revisión manual no se dan por aprobados por estas comprobaciones: requieren al responsable funcional (`firmaRevisionFuncional`).", "",
    ...(delegated.length ? ["## Runners delegados", "", ...delegated.map(d => `- ${d.criterio}: \`${d.comando}\` → exit ${d.exit}`)] : []),
  ];
  await fs.writeFile(path.join(input.outDir, "informe.md"), lines.join("\n") + "\n");
  return { results, summary, delegated };
}

/** VA evidence/checkpoints are immutable; manual review is a separate offline receipt. */
export { runVaMatrix as produceValidationEvidence } from './validation/vaRunner.js';
