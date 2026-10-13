# Baseline SPEC006

Fecha civil: 2026-10-10 (America/Bogota). Commit: `3f56d8e91a78e8cf9f39c86472940f58eb5f09e8`. Rama: `develop`.

Fotografía anterior a cambios de SPEC006. Las marcas no sustituyen evidencia de aceptación.

## Lockfiles y comandos

- backend/package-lock.json SHA-256: `8bb647de204d44df7312163017eb49a1b8ec2bf1ce7774aa55e0ffa3833aa3b8`.
```json
{
  "dev": "tsx watch src/index.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "test": "node --import tsx --test test/*.test.ts",
  "typecheck": "tsc -p tsconfig.check.json",
  "test:integration": "npm run test:di-integration",
  "baseline:queries": "tsx scripts/extract-queries.ts",
  "baseline:capture": "tsx scripts/capture-baseline.ts",
  "baseline:check": "tsx scripts/check-baseline.ts",
  "bench:stages": "node --import tsx scripts/bench-stages.ts",
  "bench:rerank": "node --import tsx scripts/bench-rerank.ts",
  "golden:candidates": "node --import tsx scripts/build-golden-candidates.ts",
  "golden:finalize": "node --import tsx scripts/finalize-golden-set.ts",
  "eval:retrieval": "node --import tsx scripts/eval-retrieval.ts",
  "test:all": "npm test && npm run test:di-integration && npm run test:ui-integration && npm run test:in-integration && npm run test:kb-integracion",
  "kb": "node --import tsx src/kb/cli.ts",
  "test:kb-integracion": "node --import tsx --test --test-concurrency=1 test/kb-integracion/*.test.ts",
  "test:di-integration": "node --import tsx --test --test-concurrency=1 test/di-integracion/*.test.ts",
  "eval:injection": "node --import tsx scripts/eval-injection.ts",
  "check:iam": "node --import tsx scripts/check-iam-policy.ts",
  "eval:tokenizer": "node --import tsx scripts/eval-tokenizer.ts",
  "eval:di": "node --import tsx scripts/eval-di.ts",
  "eval:di-traffic": "node --import tsx scripts/eval-di-traffic.ts",
  "eval:di-load": "node --import tsx scripts/eval-di-load.ts",
  "eval:di-host": "node --import tsx scripts/eval-di-host.ts",
  "in-collect": "node --import tsx scripts/in-collect-results.ts",
  "report:in": "node --import tsx scripts/report-in.ts",
  "scan:secrets": "node --import tsx scripts/scan-secrets.ts",
  "test:ui-integration": "node --import tsx --test --test-concurrency=1 test/ui-integracion/*.test.ts",
  "test:in-integration": "node --import tsx --test --test-concurrency=1 test/in-integracion/*.test.ts"
}
```
- frontend/package-lock.json SHA-256: `10bd7d9649a32c3069df19b6ecd7e750bb623aad01128decc633b671ec337e67`.
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "node --import tsx --test test/di-*.test.ts test/di-*.test.mts",
  "typecheck": "tsc --noEmit -p tsconfig.json",
  "build:widget": "node scripts/build-widget.mjs",
  "test:ui": "vitest run",
  "test:ui:e2e": "playwright test",
  "build:e2e": "node scripts/build-widget.mjs && NEXT_OUTPUT=export NEXT_PUBLIC_AGENT_API_URL=/api/chat NEXT_PUBLIC_HOST_ORIGIN=http://localhost:4310 next build && node scripts/build-csp.mjs --out out --target csp-chat.e2e.conf --ancestor http://localhost:4310"
}
```

## Estado documental actual

| Spec | Total | Marcadas | Pendientes |
|---|---:|---:|---|
| 001-base-conocimiento-bloque1 | 92 | 89 | T082, T083, T092 |
| 002-diseno-modelo-ia | 102 | 94 | T092, T093, T094, T095, T096, T097, T098, T102 |
| 003-diseno-conversacional | 36 | 35 | T035 |
| 004-interfaz-plataforma | 84 | 77 | T078, T079, T080, T081, T082, T083, T084 |
| 005-integracion-c3-c4 | 82 | 73 | T074, T075, T076, T077, T078, T079, T080, T081, T082 |

## Cambios locales previos

```text
 M .env.example
 M .gitignore
 M Makefile
 M README.md
 M backend/Dockerfile
 M backend/package-lock.json
 M backend/package.json
 M backend/scripts/bench-rerank.ts
D  backend/scripts/bench-retrieval.ts
 M backend/scripts/bench-stages.ts
D  backend/scripts/bench-worker.ts
 M backend/scripts/eval-retrieval.ts
 M backend/scripts/lib/goldenSet.ts
 M backend/scripts/lib/runBaseline.ts
D  backend/scripts/probe-rebuild-oom.ts
D  backend/scripts/summarize-extraction-gaps.ts
 M backend/src/gemini/askGemini.ts
 M backend/src/index.ts
D  backend/src/indexDocuments.ts
 M backend/src/ollama/askOllama.ts
 M backend/src/prompts/tutorPrompt.ts
 M backend/src/routes/auth.ts
 M backend/src/routes/chat.ts
 M backend/src/services/answerQuestion.ts
 M backend/src/services/chatTraffic.ts
 M backend/src/services/chunking.ts
 M backend/src/services/documentLinks.ts
 M backend/src/services/documentPreprocessor.ts
 M backend/src/services/embeddings.ts
D  backend/src/services/indexSnapshot.ts
 M backend/src/services/llm.ts
 M backend/src/services/pii.ts
 M backend/src/services/reranker.ts
 M backend/src/services/retrievalClient.ts
 M backend/src/services/retrievalWorker.ts
 M backend/src/services/search.ts
 M backend/src/services/settings.ts
 M backend/src/shared/chatHistory.ts
 M backend/src/shared/llmTypes.ts
 M backend/src/shared/openAiCompatible.ts
 M backend/src/shared/retry.ts
 M backend/test/chat-traffic.test.ts
D  backend/test/chunk-cache-prune.test.ts
 M backend/test/chunking.test.ts
 M backend/test/diversity.test.ts
 M backend/test/document-links.test.ts
 D backend/test/http-smoke.ts
D  backend/test/index-snapshot.test.ts
D  backend/test/relevance-threshold.test.ts
 M backend/test/retry.test.ts
 M backend/test/settings.test.ts
 D backend/test/smoke.ts
 M docker-compose.yml
 M docs/arquitectura-sistema.md
 M frontend/Dockerfile
 M frontend/app/globals.css
 M frontend/app/layout.tsx
 M frontend/app/page.tsx
 M frontend/next-env.d.ts
 M frontend/nginx.conf
 M frontend/package-lock.json
 M frontend/package.json
 M frontend/shared/ChatMarkdown.tsx
 M frontend/shared/agentConfig.ts
 D frontend/shared/agentTypes.ts
 M frontend/shared/session.ts
 M frontend/smart/SmartAgentPanel.tsx
 M frontend/tsconfig.json
 M web_scraper/Dockerfile
 M web_scraper/main.py
 M web_scraper/scraper/config.py
 M web_scraper/scraper/crawler.py
 M web_scraper/scraper/downloader.py
 M web_scraper/scraper/html_parser.py
 M web_scraper/scraper/metadata_store.py
 M web_scraper/scraper/relevance.py
 M web_scraper/scraper/sources.py
 M web_scraper/scraper/utils.py
 M web_scraper/tests/test_scraper.py
?? .agents/
?? .github/
?? .specify/
?? backend/config/
?? backend/db/
?? backend/migrations/
?? backend/scripts/bootstrap-admin.ts
?? backend/scripts/build-load-manifest.ts
?? backend/scripts/check-iam-policy.ts
?? backend/scripts/eval-di-host.ts
?? backend/scripts/eval-di-load.ts
?? backend/scripts/eval-di-traffic.ts
?? backend/scripts/eval-di.ts
?? backend/scripts/eval-injection.ts
?? backend/scripts/eval-tokenizer.ts
?? backend/scripts/in-collect-results.ts
?? backend/scripts/lib/diAcceptance.ts
?? backend/scripts/lib/diRunner.ts
?? backend/scripts/lib/hostRunner.ts
?? backend/scripts/lib/iamPolicy.ts
?? backend/scripts/lib/inReport.ts
?? backend/scripts/lib/injectionMatrix.ts
?? backend/scripts/lib/loadReconciliation.ts
?? backend/scripts/lib/loadRunner.ts
?? backend/scripts/lib/netCapture.ts
?? backend/scripts/lib/secretScan.ts
?? backend/scripts/migrate-chat-admin.ts
?? backend/scripts/purge-chat.ts
?? backend/scripts/report-in.ts
?? backend/scripts/scan-secrets.ts
?? backend/scripts/sonda-chat.sh
?? backend/scripts/tokenizer-oracle.py
?? backend/src/admin/
?? backend/src/app.ts
?? backend/src/bedrock/
?? backend/src/chat/
?? backend/src/kb/
?? backend/src/prompts/institutionalTexts.ts
?? backend/src/routes/adminAuth.ts
?? backend/src/routes/adminContacts.ts
?? backend/src/routes/adminOperations.ts
?? backend/src/routes/chatConfig.ts
?? backend/src/routes/conversations.ts
?? backend/src/routes/feedback.ts
?? backend/src/routes/health.ts
?? backend/src/services/alerts.ts
?? backend/src/services/calibration.ts
?? backend/src/services/circuitBreaker.ts
?? backend/src/services/diConfig.ts
?? backend/src/services/processGuards.ts
?? backend/src/services/qdrant.ts
?? backend/src/services/safeLog.ts
?? backend/src/services/selection.ts
?? backend/src/services/trustProxy.ts
?? backend/test/alerts.test.ts
?? backend/test/category-priority.test.ts
?? backend/test/circuit-breaker.test.ts
?? backend/test/di-answer-evidence.test.ts
?? backend/test/di-answer-limits.test.ts
?? backend/test/di-bedrock.test.ts
?? backend/test/di-chunking.test.ts
?? backend/test/di-config.test.ts
?? backend/test/di-followup-calibration.test.ts
?? backend/test/di-institutional-answer.test.ts
?? backend/test/di-integracion/
?? backend/test/di-model-routing.test.ts
?? backend/test/di-output-limit.test.ts
?? backend/test/di-pii.test.ts
?? backend/test/di-provider-privacy.test.ts
?? backend/test/di-retrieval-selection.test.ts
?? backend/test/di-risk-channels.test.ts
?? backend/test/di-support.ts
?? backend/test/fixtures/baseline-acotado.json
?? backend/test/fixtures/di/
?? backend/test/fixtures/formatos/
?? backend/test/fixtures/golden-set-acotado.json
?? backend/test/fixtures/in/
?? backend/test/fixtures/ocr/
?? backend/test/in-integracion/
?? backend/test/kb-blank-forms.test.ts
?? backend/test/kb-config.test.ts
?? backend/test/kb-export.test.ts
?? backend/test/kb-fichas.test.ts
?? backend/test/kb-integracion/
?? backend/test/kb-nombres.test.ts
?? backend/test/kb-ocr.test.ts
?? backend/test/kb-runreport.test.ts
?? backend/test/kb-scope.test.ts
?? backend/test/kb-sparse.test.ts
?? backend/test/ui-integracion/
?? frontend/app/admin/
?? frontend/app/chat/
?? frontend/chat/
?? frontend/playwright.config.ts
?? frontend/public/brand/
?? frontend/public/embed/
?? frontend/scripts/
?? frontend/shared/ExternalLink.tsx
?? frontend/shared/adminSession.ts
?? frontend/shared/chatClient.ts
?? frontend/shared/chatContracts.ts
?? frontend/shared/chatErrors.ts
?? frontend/shared/consent.ts
?? frontend/shared/feedbackClient.ts
?? frontend/shared/feedbackContracts.ts
?? frontend/shared/markdownRenderer.tsx
?? frontend/shared/safeUrl.ts
?? frontend/test/
?? frontend/vitest.config.ts
?? frontend/widget/
?? specs/
?? web_scraper/entrypoint.sh
?? web_scraper/scraper/cron_check.py
?? web_scraper/scraper/gmas2.py
?? web_scraper/scraper/run_report.py
?? web_scraper/scripts/capture_fixtures.py
?? web_scraper/tests/fixtures/
?? web_scraper/tests/fuentes_retiradas.py
?? web_scraper/tests/gmas2_utils.py
?? web_scraper/tests/test_cron_check.py
?? web_scraper/tests/test_derogado.py
?? web_scraper/tests/test_estructura.py
?? web_scraper/tests/test_gmas2_crawl.py
?? web_scraper/tests/test_gmas2_tables.py
?? web_scraper/tests/test_page_hash.py
?? web_scraper/tests/test_run_report.py
?? web_scraper/tests/test_sources_scope.py

```

Superficies existentes contrastadas: scripts eval-di/diAcceptance/diRunner, handleChat/orchestrator/runtime, Bedrock, arneses DI/KB/IN, runner load y report-ui. No había backend/scripts/lib/validation ni suites validation. `report-ui` inventaría archivos; no acredita corridas. Forcing DI aún pasa por routing. Fuentes oficiales, contactos, calibración publicada y aceptación real no se acreditan solo por archivo. No se ejecutó inferencia ni carga.
