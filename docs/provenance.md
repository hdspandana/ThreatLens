# Provenance Model

Every important ThreatLens output carries a `Provenance` record
(`src/lib/threatlens/schemas/models.ts`) so a reader can always answer
"where did this come from?".

```ts
{
  status: "FOUND" | "INFERRED" | "RETRIEVED" | "GENERATED" | "UNCERTAIN",
  sourceType: "EVIDENCE_FILE" | "OCR" | "USER_VERIFIED" | "TEXT_PROCESSING" | "RULE" | "ML"
            | "RISK_ENGINE" | "RETRIEVAL" | "LLM" | "DETERMINISTIC_FALLBACK"
            | "EXTERNAL_INTELLIGENCE" | "HUMAN_REVIEW",
  sourceId: string,            // rule id, model name, KB chunk id, engine name
  sourceVersion: string|null,  // rule-set / model / KB / prompt version
  confidence: number|null,     // producer confidence in [0,1]; null if not meaningful
  timestamp: string,           // ISO
  explanation: string,         // how it was produced
  derivedFrom: string[]        // upstream refs, e.g. "text:sha256:…", "signal:direct_threat.01@12"
}
```

## Epistemic statuses

| Status | Meaning | Producers today |
|---|---|---|
| **FOUND** | Present in the evidence itself | OCR raw text (`OCR`), human-verified text (`USER_VERIFIED`) |
| **INFERRED** | Derived from FOUND data by a deterministic or statistical model | rule signals (`RULE`), risk (`RISK_ENGINE`), template summary (`DETERMINISTIC_FALLBACK`) |
| **RETRIEVED** | Looked up in a reference source; not derived from the evidence | KB chunks (`RETRIEVAL`) |
| **GENERATED** | Written by a generative model; explanatory only, never evidence | LLM explanation (`LLM`) |
| **UNCERTAIN** | Explicitly unknown / not computable | OCR disabled/failed, insufficient text for risk, legacy rows |

Rules of the model:
1. A GENERATED output can never be promoted to FOUND or INFERRED. The LLM
   explains findings; it does not create them.
2. `derivedFrom` references contain hashes or ids, never content, so
   provenance can be logged and exported safely.
3. Human review (Phase 4) will add `HUMAN_REVIEW` records *alongside*
   machine output; machine output is never overwritten.
4. Rows written before provenance existed are read back with
   `sourceId: "legacy_row"` and status `UNCERTAIN` — we do not fabricate history.

## Pipeline versions

Each analysis also stores a `PipelineVersions` block:
`pipelineVersion`, `textProcessingVersion`, `classifierName/Version`,
`riskEngineVersion`, `knowledgeBaseVersion` (declared version + content hash),
`retrievalMethod`, `llmProvider/Model`, `promptVersion`, `ocrEngine/Version`,
`ocrLanguageDataSha256`, plus `inputTextSha256` and a `correlationId`.
Version constants live in `src/lib/threatlens/provenance.ts` (`VERSIONS`);
bump the relevant constant whenever a stage's behaviour changes.

## Where it surfaces
- API responses (`/api/evidence/:id`, `/api/evidence/:id/analyze`).
- Markdown report: `[FOUND]`, `[INFERRED]`, `[RETRIEVED]`, `[GENERATED]`
  badges, a "Reproducibility Metadata" section and a legend.
- `/api/health` → `pipeline` block describes the currently deployed versions.
