/**
 * Drizzle schema for ThreatLens.
 *
 * Table design mirrors the pipeline stages so each step's data is stored
 * independently: original evidence metadata, raw OCR output, the
 * human-verified text, and the downstream analysis bundle. Nothing here
 * stores the original file bytes -- those live on disk under
 * `storage/evidence/<id>/` (see evidence/service.ts) and are referenced by
 * `storedPath`.
 *
 * Phase 1 (foundation hardening) additions -- all ADDITIVE and nullable so
 * previously written rows remain valid:
 *   - `cases` + `evidence.case_id`: an evidence item may belong to a case
 *     (full case management arrives in Phase 4; this is the data foundation).
 *   - `ocr_results.engine_version` / `language_data_sha256` / `provenance`.
 *   - `analyses.correlation_id`, `input_text_sha256`, `classifier_name`,
 *     `classifier_version`, `pipeline_versions`: reproducibility metadata.
 *   - `audit_events`: append-only, content-free audit trail.
 *   - `review_decisions`: human-in-the-loop decisions stored ALONGSIDE (never
 *     overwriting) machine output. API surface arrives in Phase 4.
 */
import { pgTable, uuid, text, integer, real, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const casesTable = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceTable = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey(),
    caseId: uuid("case_id").references(() => casesTable.id, { onDelete: "set null" }),
    originalFilename: text("original_filename").notNull(),
    storedPath: text("stored_path").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    detectedMimeType: text("detected_mime_type"),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_case_id_idx").on(t.caseId), index("evidence_sha256_idx").on(t.sha256)]
);

export const ocrResultsTable = pgTable("ocr_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  evidenceId: uuid("evidence_id")
    .notNull()
    .references(() => evidenceTable.id, { onDelete: "cascade" }),
  engine: text("engine").notNull(),
  engineVersion: text("engine_version"),
  language: text("language").notNull(),
  languageDataSha256: text("language_data_sha256"),
  rawText: text("raw_text").notNull(),
  confidence: real("confidence"),
  regions: jsonb("regions").notNull(),
  warnings: jsonb("warnings").notNull(),
  succeeded: boolean("succeeded").notNull(),
  errorMessage: text("error_message"),
  provenance: jsonb("provenance"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifiedTextsTable = pgTable("verified_texts", {
  id: uuid("id").primaryKey().defaultRandom(),
  evidenceId: uuid("evidence_id")
    .notNull()
    .references(() => evidenceTable.id, { onDelete: "cascade" }),
  verifiedText: text("verified_text").notNull(),
  /** SHA-256 of verified_text; lets an analysis prove which exact revision it consumed. */
  textSha256: text("text_sha256"),
  editedByUser: boolean("edited_by_user").notNull().default(true),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});

export const analysesTable = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidenceTable.id, { onDelete: "cascade" }),
    correlationId: text("correlation_id"),
    inputTextSha256: text("input_text_sha256"),
    classifierName: text("classifier_name"),
    classifierVersion: text("classifier_version"),
    processedText: jsonb("processed_text").notNull(),
    signals: jsonb("signals").notNull(),
    risk: jsonb("risk").notNull(),
    references: jsonb("references").notNull(),
    llm: jsonb("llm").notNull(),
    pipelineVersions: jsonb("pipeline_versions"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analyses_evidence_id_idx").on(t.evidenceId)]
);

/** Append-only. Rows are never updated or deleted by application code. Details are content-free. */
export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => casesTable.id, { onDelete: "set null" }),
    evidenceId: uuid("evidence_id").references(() => evidenceTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    actor: text("actor").notNull().default("local_user"),
    correlationId: text("correlation_id").notNull(),
    details: jsonb("details").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_evidence_id_idx").on(t.evidenceId), index("audit_events_case_id_idx").on(t.caseId)]
);

/**
 * Human review decisions about machine output. The machine output itself is
 * immutable; a decision references it by (analysis id, target type, target ref).
 */
export const reviewDecisionsTable = pgTable(
  "review_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidenceTable.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id").references(() => analysesTable.id, { onDelete: "cascade" }),
    /** "signal" | "risk" | "ocr" | "reference" | "timeline_event" */
    targetType: text("target_type").notNull(),
    /** Stable pointer into the machine output, e.g. "direct_threat.01@12" (detectorId@startOffset). */
    targetRef: text("target_ref").notNull(),
    /** "CONFIRMED" | "REJECTED" | "MODIFIED" */
    decision: text("decision").notNull(),
    note: text("note"),
    modifiedValue: jsonb("modified_value"),
    reviewer: text("reviewer").notNull().default("local_user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("review_decisions_evidence_id_idx").on(t.evidenceId)]
);
