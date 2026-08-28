/**
 * Drizzle schema for ThreatLens.
 *
 * Table design mirrors the pipeline stages so each step's data is stored
 * independently: original evidence metadata, raw OCR output, the
 * human-verified text, and the downstream analysis bundle. Nothing here
 * stores the original file bytes -- those live on disk under
 * `storage/evidence/<id>/` (see evidence/service.ts) and are referenced by
 * `storedPath`.
 */
import { pgTable, uuid, text, integer, real, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

export const evidenceTable = pgTable("evidence", {
  id: uuid("id").primaryKey(),
  originalFilename: text("original_filename").notNull(),
  storedPath: text("stored_path").notNull(),
  declaredMimeType: text("declared_mime_type").notNull(),
  detectedMimeType: text("detected_mime_type"),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ocrResultsTable = pgTable("ocr_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  evidenceId: uuid("evidence_id")
    .notNull()
    .references(() => evidenceTable.id, { onDelete: "cascade" }),
  engine: text("engine").notNull(),
  language: text("language").notNull(),
  rawText: text("raw_text").notNull(),
  confidence: real("confidence"),
  regions: jsonb("regions").notNull(),
  warnings: jsonb("warnings").notNull(),
  succeeded: boolean("succeeded").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifiedTextsTable = pgTable("verified_texts", {
  id: uuid("id").primaryKey().defaultRandom(),
  evidenceId: uuid("evidence_id")
    .notNull()
    .references(() => evidenceTable.id, { onDelete: "cascade" }),
  verifiedText: text("verified_text").notNull(),
  editedByUser: boolean("edited_by_user").notNull().default(true),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});

export const analysesTable = pgTable("analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  evidenceId: uuid("evidence_id")
    .notNull()
    .references(() => evidenceTable.id, { onDelete: "cascade" }),
  processedText: jsonb("processed_text").notNull(),
  signals: jsonb("signals").notNull(),
  risk: jsonb("risk").notNull(),
  references: jsonb("references").notNull(),
  llm: jsonb("llm").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
