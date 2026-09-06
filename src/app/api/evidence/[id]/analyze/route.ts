/**
 * POST /api/evidence/:id/analyze
 * Runs the full deterministic analysis pipeline (text processing -> signal
 * detection -> risk scoring -> retrieval -> LLM explanation) against the
 * latest human-verified text and persists the result with full
 * provenance and pipeline-version metadata.
 */
import {
  getEvidence,
  getLatestOcrResult,
  getLatestVerifiedText,
  insertAnalysis,
  recordAuditEvent,
} from "@/lib/threatlens/repository";
import { runAnalysisPipeline } from "@/lib/threatlens/pipeline";
import { errorSummary, newCorrelationId, safeLog } from "@/lib/threatlens/security";
import { requireUuidParam } from "@/lib/threatlens/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invalid = requireUuidParam(id);
  if (invalid) return invalid;
  const correlationId = newCorrelationId();

  const evidence = await getEvidence(id);
  if (!evidence) {
    return Response.json({ error: "Evidence not found." }, { status: 404 });
  }

  const verifiedText = await getLatestVerifiedText(id);
  if (verifiedText === null) {
    return Response.json(
      { error: "No verified text found. Please verify the OCR text (or enter it manually) before analyzing." },
      { status: 400 }
    );
  }

  const ocr = await getLatestOcrResult(id);
  const startedAt = Date.now();

  try {
    const analysis = await runAnalysisPipeline({
      evidenceId: id,
      verifiedText,
      ocrConfidence: ocr?.confidence ?? null,
      ocrLanguageDataSha256: ocr?.languageDataSha256 ?? null,
      correlationId,
    });
    const { id: analysisId } = await insertAnalysis(analysis);
    analysis.id = analysisId;

    await recordAuditEvent({
      action: "ANALYSIS_COMPLETED",
      correlationId,
      evidenceId: id,
      caseId: evidence.caseId,
      details: {
        analysisId,
        inputTextSha256: analysis.inputTextSha256,
        signalCount: analysis.signals.length,
        severity: analysis.risk.severity,
        score: analysis.risk.score,
        llmUsedFallback: analysis.llm.usedFallback,
        pipelineVersions: analysis.pipelineVersions,
        durationMs: Date.now() - startedAt,
      },
    });

    return Response.json({ analysis });
  } catch (err) {
    safeLog("error", "analysis.failed", { correlationId, evidenceId: id, error: errorSummary(err) });
    await recordAuditEvent({
      action: "ANALYSIS_FAILED",
      correlationId,
      evidenceId: id,
      caseId: evidence.caseId,
      details: { error: errorSummary(err) },
    }).catch(() => undefined);
    return Response.json({ error: "Analysis failed unexpectedly.", correlationId }, { status: 500 });
  }
}
