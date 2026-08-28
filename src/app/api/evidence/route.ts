/**
 * POST /api/evidence
 * Handles evidence intake: validate upload -> preserve original bytes ->
 * hash -> persist metadata -> run OCR -> persist OCR result.
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
import { insertEvidence, insertOcrResult, listEvidence } from "@/lib/threatlens/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listEvidence();
    return Response.json({ evidence: items });
  } catch (err) {
    return Response.json({ error: "Failed to list evidence." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

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
      originalFilename: file.name,
      storedPath,
      declaredMimeType: validated.declaredMimeType,
      detectedMimeType: validated.detectedMimeType,
      sizeBytes: validated.sizeBytes,
      sha256,
    });

    await insertEvidence(evidenceRecord);

    const ocrResult = await runOcr({ evidenceId, imageBuffer: validated.buffer });
    await insertOcrResult(ocrResult);

    return Response.json({ evidence: evidenceRecord, ocr: ocrResult }, { status: 201 });
  } catch (err) {
    if (err instanceof EvidenceValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Evidence intake failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Evidence intake failed unexpectedly." }, { status: 500 });
  }
}
