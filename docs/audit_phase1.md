# ThreatLens — Phase 1 Repository Audit & Foundation Hardening

_Audit of the `foundation` branch, followed by the P0 changes implemented in this phase._

---

## A. CURRENT STATE — what already worked

| Area | Status before Phase 1 |
|---|---|
| Stack | Next.js (App Router) + TypeScript + PostgreSQL/Drizzle. Business logic in framework-free modules under `src/lib/threatlens/`. |
| Evidence intake | Extension allow-list, magic-byte sniffing (PNG/JPEG/BMP/WEBP with RIFF→WEBP confirmation), size limit, UUID-derived storage path (user filename never touches the filesystem), write-once `wx` flag (immutability), SHA-256 for integrity only. |
| Raw vs verified text | `ocr_results.raw_text` never overwritten; human-verified text stored as a separate append-only revision in `verified_texts`. Downstream analysis consumes verified text only. |
| Signal detection | Deterministic regex/lexicon rule set (26 rules, 11 categories), each with a hand-assigned confidence and explanation; span offsets recorded. |
| Classifier abstraction | `ThreatClassifier` interface + `RuleBasedClassifier`; `MLClassifier` honestly throws "not implemented" instead of masquerading. |
| Risk engine | Documented additive heuristic (tier × confidence, capped at 10, thresholds configurable), explicit uncertainty reasons, `INSUFFICIENT_INFORMATION` state. |
| Retrieval | Local TF-IDF/cosine index over a small bundled reference dataset; no network. |
| LLM layer | OpenAI-compatible call receiving structured findings, with deterministic fallback when key absent / call fails / times out. |
| Reporting | Markdown report with disclaimer, integrity-vs-authenticity note, limitations section. |
| Evaluation | Classifier (multi-label P/R/F1, n=27) and retrieval (recall@3, n=8) scripts; CER/WER metric implementation. |
| Tests | 63 vitest tests across evidence, OCR, signals, risk, retrieval, LLM, reporting, text processing, config. |
| Docs | README, `docs/architecture.md`, honest dataset notices. |

## B. MISSING — incomplete or absent

1. **Working OCR.** The bundled `data/tessdata/eng.traineddata` was **corrupt**: every `0xFF` byte had been replaced by the UTF-8 replacement sequence `EF BF BD` (379,904 occurrences) — the binary had been passed through a text encoder. tesseract.js could never initialise ("LSTM requested, but not present"). The OCR unit test timed out at 30 s and the core UPLOAD → EXTRACT step of the product did not function.
2. **Structured provenance.** FOUND/INFERRED/RETRIEVED/GENERATED/UNCERTAIN existed as a design principle and as prose, but no machine-readable provenance record was attached to outputs.
3. **Pipeline/model versioning.** Analyses recorded no classifier, rule-set, risk-engine, KB, prompt, or OCR versions. An old report could not be reproduced or audited.
4. **Case concept, audit trail, human-review storage.** None in the data model.
5. **Correlation IDs / safe telemetry.** Errors were logged with raw `err.message` via `console.error`; no correlation ids; no stage timings.
6. **Prompt-injection controls.** Evidence text was embedded in the LLM prompt as a plain JSON field with no trust-boundary framing and no output screening.
7. **OCR evaluation data.** No labeled image set; the OCR eval script printed a limitation notice only.
8. **npm scripts** for tests/evals (README instructed raw `npx` invocations).

## C. WEAK — present but too basic

- **Route parameter handling:** any string reached Postgres as a `uuid` cast → unhandled 500 for malformed ids (probing surface, noisy errors).
- **Upload DoS:** `request.formData()` buffered the entire body before the size check ran.
- **Report injection:** evidence text was placed in ```` ``` ```` fences; a payload containing ```` ``` ```` could break out and inject markdown/HTML. Inline fields (filename, spans, titles) were unescaped.
- **LLM error handling:** the provider's HTTP error body (up to 200 chars) was surfaced verbatim in warnings.
- **OCR worker configuration:** `cachePath` pointed at the bundled data dir; tesseract.js *deletes* cached language files on init failure — the first failed test run **deleted the bundled model**. `gzip: true` also meant `langPath` lookups targeted a non-existent `.gz` file.
- **Retrieval provenance:** references carried no KB version or chunk id.
- **Risk decomposition:** contributing factors listed tier and count but not the exact numeric contribution.
- **Legacy Python files** (`app.py`, `nyayaai/`, `tests/test_*.py`, `requirements.txt`, `pytest.ini`) from an earlier "NyayaAI/Streamlit" iteration are still in the tree. They are not wired to anything. Left in place this phase (no functionality deleted); recommend archiving under `legacy/` with the user's approval.

## D. ARCHITECTURAL RISKS if left unfixed

1. Shipping a broken OCR model silently degrades the flagship "local OCR" claim to "manual transcription".
2. Without provenance records, later phases (correlation, timeline, review) would have nothing to attach FOUND/INFERRED labels to, and the UI could only fake the distinction.
3. Without versioning, Phase 2 (ML classifier) could not be compared to the baseline on stored analyses, and the "reproducible analysis" requirement would be unattainable retroactively.
4. Without a case table and audit trail, Phases 4–5 would require destructive schema migrations.
5. LLM prompt without a trust boundary means every later feature that feeds text to the model inherits an injection hole.

## E. FINAL ARCHITECTURE GAP (summary)

| Target capability | Foundation | After Phase 1 | Remaining phase |
|---|---|---|---|
| Secure ingestion / immutability | ✔ | ✔ + size pre-check, audit | 8 (authz, encryption, deletion) |
| OCR + verification | ✖ (broken) | ✔ working, hash-pinned, versioned | 9 (multilingual) |
| Provenance model | prose only | ✔ structured on every stage | UI badges (11) |
| Versioning / reproducibility | ✖ | ✔ per-analysis | — |
| Case / audit / review storage | ✖ | ✔ tables + minimal API | 4 (workflow) |
| Prompt-injection defence | ✖ | ✔ boundary + guard + tests | 8 (deeper red-team) |
| Real ML classifier | ✖ | contract ready (`ClassificationResult`, metadata) | 2 |
| Context / timeline / correlation / graph | ✖ | ✖ | 3, 5 |
| Adversarial eval | ✖ | ✖ | 6 |
| Threat-intel adapters | ✖ | ✖ | 7 |
| Professional UI | 4-step wizard | unchanged | 11 |

## F. PRIORITIZED ROADMAP

**P0 (this phase)** — fix OCR; provenance + versions; case/audit/review data model; route hardening; prompt-injection boundary; safe logging; markdown escaping; e2e + security tests; real OCR baseline.

**P1** — Phase 2 ML classifier contract + dataset + eval harness with baseline comparison; Phase 3 conversation windows, escalation, timeline; Phase 4 case workflow + review API/UI.

**P2** — Phase 5 entity extraction + cross-evidence correlation + incident graph; Phase 6 adversarial/evasion suite; Phase 7 knowledge base v2 + threat-intel adapter interface; Phase 8 auth/authz, field encryption, secure deletion.

**P3** — Phase 9 multilingual; Phase 10 reporting/observability dashboards; Phase 11 investigation UI; archive legacy Python.

---

## G. FIRST IMPLEMENTATION — what changed in Phase 1

### Files added
- `data/tessdata/eng.traineddata.gz` — genuine `tessdata_fast` English model (Apache-2.0), gzipped; `data/tessdata/MANIFEST.json` pins SHA-256 (gz + uncompressed).
- `src/lib/threatlens/provenance.ts` — `makeProvenance`, `VERSIONS` registry, `textRef`, `sha256Hex`, `summarizeStatuses`.
- `src/lib/threatlens/security/index.ts` — `isUuid`, `safeLog` (content-free, control-char stripped, level switch), `detectInjectionIndicators`, `wrapUntrustedText`, `guardLlmOutput`, `fencedBlock`, `escapeInlineMarkdown`.
- `src/lib/threatlens/security/http.ts` — `requireUuidParam`, `rejectOversizedRequest`, `downloadHeaders`.
- `src/app/api/cases/route.ts`, `src/app/api/cases/[id]/route.ts`, `src/app/api/evidence/[id]/audit/route.ts`.
- `data/evaluation/ocr_examples/` — 3 rendered labeled images + manifest.
- `tests/fixtures.ts`, `tests/provenance.test.ts`, `tests/pipeline.integration.test.ts`, `tests/security.test.ts`, `tests/llm.prompt_injection.test.ts`, `tests/ocr.integrity.test.ts`.
- `docs/audit_phase1.md` (this file), `docs/threat_model.md`, `docs/provenance.md`.

### Files changed (behaviour preserved, capabilities added)
- `schemas/models.ts` — `Provenance`, `EpistemicStatus`, `PipelineVersions`, `CaseRecord`, `AuditEvent`; provenance/version fields on OCR, processed text, signals (`detectorId`), risk (`contribution`, `engineVersion`), references (`chunkIndex`, `knowledgeBaseVersion`), LLM (`promptVersion`, `outputGuard`), analysis (`id`, `correlationId`, `inputTextSha256`, `pipelineVersions`).
- `ocr/service.ts` — manifest verification, `cacheMethod: "none"`, engine version + model hash recorded, provenance.
- `analysis/signals.ts` — stable rule ids (`category.NN`), `RULE_SET_VERSION`, provenance per signal. **No pattern or confidence changed** (classifier eval identical: F1 0.976).
- `analysis/classifier.ts` — `metadata()`, `ClassificationResult` (signals + category scores + metadata). `MLClassifier` still honestly unavailable.
- `risk/scorer.ts` — exact `contribution` per factor, `engineVersion`, provenance. **Formula unchanged.**
- `retrieval/*` — KB `version` + content hash, `RETRIEVED` provenance per chunk.
- `text/processing.ts` — injection-indicator scan (records, never removes), provenance.
- `llm/service.ts` — trust-boundary prompt v2, output guard, no provider body echo, provenance (`GENERATED` vs `DETERMINISTIC_FALLBACK`).
- `pipeline.ts` — versions block, input hash, correlation id, stage timings via `safeLog`, injectable classifier, `describePipeline()`.
- `reporting/service.ts` — fence-safe blocks, inline escaping, provenance badges, reproducibility + legend sections.
- `repository.ts` — new columns; cases, audit, review functions; legacy-row tolerance.
- `db/schema.ts` — additive columns + `cases`, `audit_events`, `review_decisions` tables + indexes.
- API routes — UUID guard (404), size pre-check (413), audit events, correlation ids, safe logging; upload accepts optional `caseId`; `/api/health` reports pipeline versions and OCR integrity.
- `eval/evaluate_ocr.ts` — now runs real OCR and reports CER/WER/confidence/latency.
- `vitest.config.ts` — silent telemetry in tests. `package.json` — `test`, `eval:*` scripts.

### Not changed
- UI (`ThreatLensApp.tsx`) — still the 4-step wizard; it continues to work because all additions are backward-compatible fields. UI redesign is Phase 11.
- Detection rules, risk formula, retrieval algorithm, KB content.

### Tests run
- Before: 62 passed, 1 failed (OCR timeout — model corrupt).
- After: **100 passed, 0 failed** (`npm test`), including a real OCR recognition test.

### Evaluation results
| Script | Before | After |
|---|---|---|
| Classifier (n=27) | exact-set 0.963, micro P/R/F1 1.00/0.952/0.976 | identical |
| Retrieval (n=8) | recall@3 = 1.0 | identical |
| OCR | not runnable | mean CER 0.011, WER 0.056, confidence 95, ~150 ms/img (synthetic, easy set) |

### Remaining issues / known limitations
- No authentication or per-case authorization yet (single local user assumed) — Phase 8.
- `review_decisions` has storage + repository functions but no API/UI — Phase 4.
- OCR eval set is synthetic; real screenshot accuracy is unknown.
- Injection indicators are regex heuristics; they inform the guard, they do not "prove" an attack.
- Legacy Python files remain untouched pending approval to archive.
- Old rows written before this phase are read back with explicit `legacy` provenance markers rather than fabricated versions.

### How to verify manually
```bash
npm test                               # 100 tests
npm run eval                           # classifier, retrieval, OCR baselines → eval/results/*.json
curl -s localhost:3000/api/health | jq  # database:true, ocr.ok:true, pipeline versions
curl -s -F file=@data/evaluation/ocr_examples/ocr-01.png localhost:3000/api/evidence | jq '.ocr.rawText,.ocr.provenance'
# → then verify, analyze, report, audit as shown in README "End-to-end workflow"
curl -s localhost:3000/api/evidence/not-a-uuid            # 404, not 500
curl -s -H 'Content-Length: 999999999' -X POST localhost:3000/api/evidence   # 413
```

### Next recommended phase
**Phase 2 — Real classification:** dataset schema + labeling guide, train/eval harness (precision/recall/F1/confusion, per-class), model registry (`ClassificationResult.metadata` is already the contract), side-by-side comparison against `rule_based@rules_v1.0.0` on the same dataset, and an `ensemble` option that keeps rule provenance visible.
