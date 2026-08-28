/**
 * Persistence layer. Isolates Drizzle/Postgres queries from API routes and
 * from the pure business-logic modules (evidence/ocr/analysis stay
 * database-agnostic and are unit-testable without a DB connection).
 */
import { db } from "@/db";
import { analysesTable, evidenceTable, ocrResultsTable, verifiedTextsTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import type { AnalysisResult, EvidenceRecord, OcrResult } from "./schemas/models";

export async function insertEvidence(record: EvidenceRecord): Promise<void> {
  await db.insert(evidenceTable).values({
    id: record.id,
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
  if (!row) return null;
  return {
    id: row.id,
    originalFilename: row.originalFilename,
    storedPath: row.storedPath,
    declaredMimeType: row.declaredMimeType,
    detectedMimeType: row.detectedMimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

export async function listEvidence(limit = 25): Promise<EvidenceRecord[]> {
  const rows = await db.select().from(evidenceTable).orderBy(desc(evidenceTable.uploadedAt)).limit(limit);
  return rows.map((row) => ({
    id: row.id,
    originalFilename: row.originalFilename,
    storedPath: row.storedPath,
    declaredMimeType: row.declaredMimeType,
    detectedMimeType: row.detectedMimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadedAt: row.uploadedAt.toISOString(),
  }));
}

export async function insertOcrResult(result: OcrResult): Promise<void> {
  await db.insert(ocrResultsTable).values({
    evidenceId: result.evidenceId,
    engine: result.engine,
    language: result.language,
    rawText: result.rawText,
    confidence: result.confidence,
    regions: result.regions,
    warnings: result.warnings,
    succeeded: result.succeeded,
    errorMessage: result.errorMessage,
    createdAt: new Date(result.createdAt),
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
  return {
    evidenceId: row.evidenceId,
    engine: "tesseract.js",
    language: row.language,
    rawText: row.rawText,
    confidence: row.confidence,
    regions: row.regions as OcrResult["regions"],
    warnings: row.warnings as string[],
    succeeded: row.succeeded,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertVerifiedText(params: { evidenceId: string; verifiedText: string }): Promise<void> {
  await db.insert(verifiedTextsTable).values({
    evidenceId: params.evidenceId,
    verifiedText: params.verifiedText,
    editedByUser: true,
  });
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

export async function insertAnalysis(analysis: AnalysisResult): Promise<void> {
  await db.insert(analysesTable).values({
    evidenceId: analysis.evidenceId,
    processedText: analysis.processedText,
    signals: analysis.signals,
    risk: analysis.risk,
    references: analysis.references,
    llm: analysis.llm,
    createdAt: new Date(analysis.createdAt),
  });
}

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
    evidenceId: row.evidenceId,
    processedText: row.processedText as AnalysisResult["processedText"],
    signals: row.signals as AnalysisResult["signals"],
    risk: row.risk as AnalysisResult["risk"],
    references: row.references as AnalysisResult["references"],
    llm: row.llm as AnalysisResult["llm"],
    createdAt: row.createdAt.toISOString(),
  };
}
