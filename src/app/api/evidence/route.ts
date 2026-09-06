/**
 * POST /api/evidence
 * Handles evidence intake: validate upload -> preserve original bytes ->
 * hash -> persist metadata -> run OCR -> persist OCR result -> audit.
 *
 * Optional multipart field `caseId` (UUID) attaches the evidence to an
 * existing case at intake time.
 *
 * GET /api/evidence
 * Lists recently uploaded evidence (for the UI's evidence picker).
 */
import { NextRequest } from "next/server";
import {
  EvidenceValidationError,
  buildEvidenceRecord,
  computeSha256,
  generateEvidenceId,
  storeOriginalEvidence,
  validateUpload,
} from "@/lib/threatlens/evidence/service";
import { runOcr } from "@/lib/threatlens/ocr/service";
import { getCase, insertEvidence, insertOcrResult, listEvidence, recordAuditEvent } from "@/lib/threatlens/repository";
import { errorSummary, isUuid, newCorrelationId, safeLog } from "@/lib/threatlens/security";
import { rejectOversizedRequest } from "@/lib/threatlens/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listEvidence();
    return Response.json({ evidence: items });
  } catch (err) {
    safeLog("error", "evidence.list.failed", { error: errorSummary(err) });
    return Response.json({ error: "Failed to list evidence." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  const tooLarge = rejectOversizedRequest(request);
  if (tooLarge) {
    safeLog("warn", "evidence.upload.rejected", { correlationId, reason: "content_length" });
    return tooLarge;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file was provided." }, { status: 400 });
  }

  const rawCaseId = formData.get("caseId");
  let caseId: string | null = null;
  if (typeof rawCaseId === "string" && rawCaseId.length > 0) {
    if (!isUuid(rawCaseId)) return Response.json({ error: "Case not found." }, { status: 404 });
    const existing = await getCase(rawCaseId);
    if (!existing) return Response.json({ error: "Case not found." }, { status: 404 });
    caseId = existing.id;
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const startedAt = Date.now();

  try {
    const validated = validateUpload({
      buffer,
      filename: file.name,
      declaredMimeType: file.type || "application/octet-stream",
    });

    const evidenceId = generateEvidenceId();
    const storedPath = await storeOriginalEvidence({
      evidenceId,
      extension: validated.extension,
      buffer: validated.buffer,
    });
    const sha256 = computeSha256(validated.buffer);

    const evidenceRecord = buildEvidenceRecord({
      id: evidenceId,
      caseId,
      originalFilename: file.name,
      storedPath,
      declaredMimeType: validated.declaredMimeType,
      detectedMimeType: validated.detectedMimeType,
      sizeBytes: validated.sizeBytes,
      sha256,
    });

    await insertEvidence(evidenceRecord);
    await recordAuditEvent({
      action: "EVIDENCE_UPLOADED",
      correlationId,
      evidenceId,
      caseId,
      details: {
        sizeBytes: validated.sizeBytes,
        detectedMimeType: validated.detectedMimeType,
        sha256,
      },
    });

    const ocrStarted = Date.now();
    const ocrResult = await runOcr({ evidenceId, imageBuffer: validated.buffer, evidenceSha256: sha256 });
    await insertOcrResult(ocrResult);
    await recordAuditEvent({
      action: ocrResult.succeeded ? "OCR_COMPLETED" : "OCR_FAILED",
      correlationId,
      evidenceId,
      caseId,
      details: {
        engine: ocrResult.engine,
        engineVersion: ocrResult.engineVersion,
        languageDataSha256: ocrResult.languageDataSha256,
        confidence: ocrResult.confidence,
        characterCount: ocrResult.rawText.length,
        durationMs: Date.now() - ocrStarted,
      },
    });

    safeLog("info", "evidence.upload.completed", {
      correlationId,
      evidenceId,
      sizeBytes: validated.sizeBytes,
      ocrSucceeded: ocrResult.succeeded,
      ocrConfidence: ocrResult.confidence,
      totalMs: Date.now() - startedAt,
    });

    return Response.json({ evidence: evidenceRecord, ocr: ocrResult, correlationId }, { status: 201 });
  } catch (err) {
    if (err instanceof EvidenceValidationError) {
      safeLog("warn", "evidence.upload.rejected", { correlationId, reason: "validation" });
      await recordAuditEvent({
        action: "EVIDENCE_REJECTED",
        correlationId,
        caseId,
        details: { reason: "validation", sizeBytes: buffer.length },
      }).catch(() => undefined);
      return Response.json({ error: err.message }, { status: 400 });
    }
    safeLog("error", "evidence.upload.failed", { correlationId, error: errorSummary(err) });
    return Response.json({ error: "Evidence intake failed unexpectedly.", correlationId }, { status: 500 });
  }
}
