# Architecture

## Goals

- Clear separation between "found", "inferred", "retrieved", "generated",
  and "uncertain" information at every layer.
- Every business-logic module is a plain, framework-independent TypeScript
  module that can be unit-tested without a running server or database.
- Replaceable components behind small interfaces (`ThreatClassifier`,
  retrieval's `retrieveReferences`, the LLM's `generateExplanation`) so
  implementations can change without touching the UI.

## Layers

```
┌───────────────────────────────────────────────────────────────────────┐
│  UI (src/components/ThreatLensApp.tsx)                                │
│  - Orchestrates the 4-step wizard, calls API routes, renders results. │
│  - Contains NO detection/scoring/retrieval logic.                     │
└───────────────────────────────────────────────────────────────────────┘
                 │ fetch()
┌───────────────────────────────────────────────────────────────────────┐
│  API routes (src/app/api/evidence/**)                                 │
│  - Thin HTTP adapters: parse request, call library functions,         │
│    map errors to HTTP status codes, persist via repository.ts.        │
└───────────────────────────────────────────────────────────────────────┘
                 │ function calls
┌───────────────────────────────────────────────────────────────────────┐
│  Pipeline (src/lib/threatlens/pipeline.ts)                             │
│  processText → classifier.classify → assessRisk → retrieveReferences  │
│  → generateExplanation                                                │
└───────────────────────────────────────────────────────────────────────┘
     │            │              │                │                │
     ▼            ▼              ▼                ▼                ▼
  text/      analysis/       risk/           retrieval/          llm/
  processing  signals.ts    scorer.ts        service.ts          service.ts
  .ts         classifier.ts
```

Evidence intake (`evidence/service.ts`) and OCR (`ocr/service.ts`) sit
upstream of this pipeline and are invoked directly from the upload API
route, since they operate on raw bytes rather than verified text.

## Data model (Postgres via Drizzle, `src/db/schema.ts`)

- `evidence` — one row per uploaded file: id (UUID), stored path, declared
  vs. detected MIME type, size, SHA-256, upload timestamp. No file bytes.
- `ocr_results` — raw OCR output, confidence, regions, warnings. Append-only;
  never updated in place.
- `verified_texts` — human-verified/corrected text, append-only (so a
  history of corrections is preserved; the API always reads the latest row).
- `analyses` — the full analysis bundle (processed text, signals, risk,
  references, LLM explanation) as JSONB, one row per analysis run.

Original file bytes live on disk under `storage/evidence/<uuid>/original.<ext>`
(configurable via `THREATLENS_STORAGE_DIR`), separate from the database and
from any derived artifact.

## Why TF-IDF instead of FAISS

FAISS requires a native binary dependency that is awkward to guarantee in a
Node.js/Next.js serverless-style deployment. Instead, `retrieval/service.ts`
implements TF-IDF weighted term vectors with cosine similarity -- a real,
fully local "vector index" with no external dependency and no network call,
which keeps retrieval independent of the LLM layer (a hard requirement).
The public function signature (`retrieveReferences`) is the only integration
point the rest of the app depends on, so a true embedding-based index could
be substituted later without touching callers.

## Why tesseract.js instead of EasyOCR

EasyOCR is a Python/PyTorch library; this project's runtime is Node.js.
`tesseract.js` is the closest equivalent: a real, local OCR engine (not a
mock), with word-level confidence and bounding boxes. To avoid a runtime
dependency on an external CDN for language data, the English trained-data
file is bundled under `data/tessdata/` and loaded from disk
(`THREATLENS_OCR_LANGDATA_DIR`).

## Classifier replaceability

`analysis/classifier.ts` defines the `ThreatClassifier` interface. The
default and only wired-in implementation is `RuleBasedClassifier`
(deterministic, offline, always available). `MLClassifier` exists as a
documented extension point that intentionally throws -- no fine-tuned
model ships with this project, and we do not want to misrepresent a base
language model as a trained classifier. Swapping in a real trained model
later only requires implementing `ThreatClassifier` and changing
`getDefaultClassifier()`.

## Risk engine transparency

`risk/scorer.ts` uses a documented ordinal heuristic (category severity
tier × signal confidence, summed and capped at 10) rather than a fitted
statistical model, because no ground-truth severity dataset exists to fit
against. Thresholds for LOW/MEDIUM/HIGH/CRITICAL are configurable via
environment variables. Every assessment reports contributing factors and an
explicit uncertainty level/reasons so the score is auditable, not a black box.

## LLM boundary

The LLM (`llm/service.ts`) only ever receives: a text excerpt, the category/
confidence/span of already-detected signals, the already-computed risk
summary, and reference titles. It cannot see the original image, and its
system prompt explicitly forbids inventing facts, citations, or legal
conclusions. If no API key is configured, if the call fails, or if it times
out, a deterministic template-based summary is returned instead -- the rest
of the pipeline (signals, risk, retrieval, report) is entirely unaffected.


## Phase 1 additions (foundation hardening)

- **Provenance layer** (`provenance.ts`, `docs/provenance.md`): every stage
  output carries `{status, sourceType, sourceId, sourceVersion, confidence,
  timestamp, explanation, derivedFrom}`; every analysis carries a
  `PipelineVersions` block and the SHA-256 of its input text.
- **Security layer** (`security/`): UUID route guard, `Content-Length`
  pre-check, content-free structured logger with correlation ids, evidence
  trust boundary for the LLM prompt, output guard, markdown escaping. See
  `docs/threat_model.md`.
- **Data model**: `cases` (+ `evidence.case_id`), `audit_events`
  (append-only), `review_decisions` (human decisions stored alongside
  immutable machine output). Version/provenance columns on `ocr_results`,
  `verified_texts` (`text_sha256`) and `analyses`.
- **OCR**: bundled `tessdata_fast` English model, gzipped and pinned by
  `data/tessdata/MANIFEST.json`; verified before the worker starts;
  tesseract.js caching disabled so it can never modify bundled data.
- **Classifier contract**: `ThreatClassifier.metadata()` and
  `ClassificationResult { signals, categoryScores, metadata }` prepare the
  Phase 2 ML classifier without changing the rule baseline.
