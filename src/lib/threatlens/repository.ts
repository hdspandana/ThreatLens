/**
 * Persistence layer. Isolates Drizzle/Postgres queries from API routes and
 * from the pure business-logic modules (evidence/ocr/analysis stay
 * database-agnostic and are unit-testable without a DB connection).
 *
 * Rows written before Phase 1 lack provenance/version columns; readers
 * below tolerate NULLs by substituting explicit "legacy" markers rather
 * than inventing provenance that never existed.
 */
import { db } from "@/db";
import {
  analysesTable,
  auditEventsTable,
  casesTable,
  evidenceTable,
  ocrResultsTable,
  reviewDecisionsTable,
  verifiedTextsTable,
} from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import type {
  AnalysisResult,
  AuditActionT,
  AuditEvent,
  CaseRecord,
  CaseStatusT,
  EvidenceRecord,
  OcrResult,
  Provenance,
} from "./schemas/models";
import { makeProvenance, sha256Hex } from "./provenance";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

function mapEvidenceRow(row: typeof evidenceTable.$inferSelect): EvidenceRecord {
  return {
    id: row.id,
    caseId: row.caseId ?? null,
    originalFilename: row.originalFilename,
    storedPath: row.storedPath,
    declaredMimeType: row.declaredMimeType,
    detectedMimeType: row.detectedMimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

export async function insertEvidence(record: EvidenceRecord): Promise<void> {
  await db.insert(evidenceTable).values({
    id: record.id,
    caseId: record.caseId,
    originalFilename: record.originalFilename,
    storedPath: record.storedPath,
    declaredMimeType: record.declaredMimeType,
    detectedMimeType: record.detectedMimeType,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    uploadedAt: new Date(record.uploadedAt),
  });
}

export async function getEvidence(id: string): Promise<EvidenceRecord | null> {
  const rows = await db.select().from(evidenceTable).where(eq(evidenceTable.id, id)).limit(1);
  const row = rows[0];
  return row ? mapEvidenceRow(row) : null;
}

export async function listEvidence(limit = 25): Promise<EvidenceRecord[]> {
  const rows = await db.select().from(evidenceTable).orderBy(desc(evidenceTable.uploadedAt)).limit(limit);
  return rows.map(mapEvidenceRow);
}

export async function listEvidenceForCase(caseId: string): Promise<EvidenceRecord[]> {
  const rows = await db
    .select()
    .from(evidenceTable)
    .where(eq(evidenceTable.caseId, caseId))
    .orderBy(desc(evidenceTable.uploadedAt));
  return rows.map(mapEvidenceRow);
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

export async function insertOcrResult(result: OcrResult): Promise<void> {
  await db.insert(ocrResultsTable).values({
    evidenceId: result.evidenceId,
    engine: result.engine,
    engineVersion: result.engineVersion,
    language: result.language,
    languageDataSha256: result.languageDataSha256,
    rawText: result.rawText,
    confidence: result.confidence,
    regions: result.regions,
    warnings: result.warnings,
    succeeded: result.succeeded,
    errorMessage: result.errorMessage,
    provenance: result.provenance,
    createdAt: new Date(result.createdAt),
  });
}

function legacyProvenance(sourceType: Provenance["sourceType"], timestamp: string): Provenance {
  return makeProvenance({
    status: "UNCERTAIN",
    sourceType,
    sourceId: "legacy_row",
    sourceVersion: null,
    confidence: null,
    explanation: "Row was written before provenance tracking existed; producer version unknown.",
    timestamp,
  });
}

export async function getLatestOcrResult(evidenceId: string): Promise<OcrResult | null> {
  const rows = await db
    .select()
    .from(ocrResultsTable)
    .where(eq(ocrResultsTable.evidenceId, evidenceId))
    .orderBy(desc(ocrResultsTable.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const createdAt = row.createdAt.toISOString();
  return {
    evidenceId: row.evidenceId,
    engine: "tesseract.js",
    engineVersion: row.engineVersion ?? "unknown(legacy)",
    language: row.language,
    languageDataSha256: row.languageDataSha256 ?? null,
    rawText: row.rawText,
    confidence: row.confidence,
    regions: row.regions as OcrResult["regions"],
    warnings: row.warnings as string[],
    succeeded: row.succeeded,
    errorMessage: row.errorMessage,
    createdAt,
    provenance: (row.provenance as Provenance | null) ?? legacyProvenance("OCR", createdAt),
  };
}

// ---------------------------------------------------------------------------
// Verified text
// ---------------------------------------------------------------------------

export async function insertVerifiedText(params: { evidenceId: string; verifiedText: string }): Promise<{ textSha256: string }> {
  const textSha256 = sha256Hex(params.verifiedText);
  await db.insert(verifiedTextsTable).values({
    evidenceId: params.evidenceId,
    verifiedText: params.verifiedText,
    textSha256,
    editedByUser: true,
  });
  return { textSha256 };
}

export async function getLatestVerifiedText(evidenceId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(verifiedTextsTable)
    .where(eq(verifiedTextsTable.evidenceId, evidenceId))
    .orderBy(desc(verifiedTextsTable.verifiedAt))
    .limit(1);
  return rows[0]?.verifiedText ?? null;
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

export async function insertAnalysis(analysis: AnalysisResult): Promise<{ id: string }> {
  const rows = await db
    .insert(analysesTable)
    .values({
      evidenceId: analysis.evidenceId,
      correlationId: analysis.correlationId,
      inputTextSha256: analysis.inputTextSha256,
      classifierName: analysis.pipelineVersions.classifierName,
      classifierVersion: analysis.pipelineVersions.classifierVersion,
      processedText: analysis.processedText,
      signals: analysis.signals,
      risk: analysis.risk,
      references: analysis.references,
      llm: analysis.llm,
      pipelineVersions: analysis.pipelineVersions,
      createdAt: new Date(analysis.createdAt),
    })
    .returning({ id: analysesTable.id });
  return { id: rows[0].id };
}

const LEGACY_PIPELINE_VERSIONS: AnalysisResult["pipelineVersions"] = {
  pipelineVersion: "legacy(pre-provenance)",
  textProcessingVersion: "unknown",
  classifierName: "rule_based",
  classifierVersion: "unknown",
  riskEngineVersion: "unknown",
  knowledgeBaseVersion: null,
  retrievalMethod: "unknown",
  llmProvider: null,
  llmModel: null,
  promptVersion: null,
  ocrEngine: null,
  ocrEngineVersion: null,
  ocrLanguageDataSha256: null,
};

export async function getLatestAnalysis(evidenceId: string): Promise<AnalysisResult | null> {
  const rows = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.evidenceId, evidenceId))
    .orderBy(desc(analysesTable.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    evidenceId: row.evidenceId,
    correlationId: row.correlationId ?? "legacy",
    inputTextSha256: row.inputTextSha256 ?? "",
    processedText: row.processedText as AnalysisResult["processedText"],
    signals: row.signals as AnalysisResult["signals"],
    risk: row.risk as AnalysisResult["risk"],
    references: row.references as AnalysisResult["references"],
    llm: row.llm as AnalysisResult["llm"],
    pipelineVersions: (row.pipelineVersions as AnalysisResult["pipelineVersions"] | null) ?? LEGACY_PIPELINE_VERSIONS,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

function mapCaseRow(row: typeof casesTable.$inferSelect): CaseRecord {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    status: row.status as CaseStatusT,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Generates the next CASE-YYYY-NNNN reference. Unique constraint on `reference` guards races. */
async function nextCaseReference(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `CASE-${year}-`;
  const result = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from ${casesTable} where ${casesTable.reference} like ${prefix + "%"}`
  );
  const count = Number.parseInt(result.rows[0]?.count ?? "0", 10);
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

export async function createCase(params: { title: string; description?: string | null }): Promise<CaseRecord> {
  // Retry a few times on reference collision (concurrent creation).
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = await nextCaseReference();
    try {
      const rows = await db
        .insert(casesTable)
        .values({ reference, title: params.title, description: params.description ?? null, status: "OPEN" })
        .returning();
      return mapCaseRow(rows[0]);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err; // not a unique violation
    }
  }
  throw new Error("Could not allocate a unique case reference.");
}

export async function getCase(id: string): Promise<CaseRecord | null> {
  const rows = await db.select().from(casesTable).where(eq(casesTable.id, id)).limit(1);
  return rows[0] ? mapCaseRow(rows[0]) : null;
}

export async function listCases(limit = 50): Promise<CaseRecord[]> {
  const rows = await db.select().from(casesTable).orderBy(desc(casesTable.createdAt)).limit(limit);
  return rows.map(mapCaseRow);
}

export async function attachEvidenceToCase(evidenceId: string, caseId: string): Promise<void> {
  await db.update(evidenceTable).set({ caseId }).where(eq(evidenceTable.id, evidenceId));
  await db.update(casesTable).set({ updatedAt: new Date() }).where(eq(casesTable.id, caseId));
}

// ---------------------------------------------------------------------------
// Audit trail (append-only)
// ---------------------------------------------------------------------------

export async function recordAuditEvent(params: {
  action: AuditActionT;
  correlationId: string;
  evidenceId?: string | null;
  caseId?: string | null;
  actor?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditEventsTable).values({
    action: params.action,
    correlationId: params.correlationId,
    evidenceId: params.evidenceId ?? null,
    caseId: params.caseId ?? null,
    actor: params.actor ?? "local_user",
    details: params.details ?? {},
  });
}

export async function listAuditEventsForEvidence(evidenceId: string, limit = 100): Promise<AuditEvent[]> {
  const rows = await db
    .select()
    .from(auditEventsTable)
    .where(eq(auditEventsTable.evidenceId, evidenceId))
    .orderBy(desc(auditEventsTable.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    caseId: row.caseId,
    evidenceId: row.evidenceId,
    action: row.action as AuditActionT,
    actor: row.actor,
    correlationId: row.correlationId,
    details: row.details as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Human review decisions (data foundation; API arrives in Phase 4)
// ---------------------------------------------------------------------------

export async function insertReviewDecision(params: {
  evidenceId: string;
  analysisId: string | null;
  targetType: "signal" | "risk" | "ocr" | "reference" | "timeline_event";
  targetRef: string;
  decision: "CONFIRMED" | "REJECTED" | "MODIFIED";
  note?: string | null;
  modifiedValue?: unknown;
  reviewer?: string;
}): Promise<{ id: string }> {
  const rows = await db
    .insert(reviewDecisionsTable)
    .values({
      evidenceId: params.evidenceId,
      analysisId: params.analysisId,
      targetType: params.targetType,
      targetRef: params.targetRef,
      decision: params.decision,
      note: params.note ?? null,
      modifiedValue: params.modifiedValue ?? null,
      reviewer: params.reviewer ?? "local_user",
    })
    .returning({ id: reviewDecisionsTable.id });
  return { id: rows[0].id };
}
