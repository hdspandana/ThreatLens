/**
 * GET /api/evidence/:id/report
 * Generates a downloadable Markdown incident documentation report from
 * whatever pipeline stages have completed so far.
 */
import {
  getEvidence,
  getLatestAnalysis,
  getLatestOcrResult,
  getLatestVerifiedText,
  recordAuditEvent,
} from "@/lib/threatlens/repository";
import { generateReportMarkdown } from "@/lib/threatlens/reporting/service";
import { newCorrelationId } from "@/lib/threatlens/security";
import { downloadHeaders, requireUuidParam } from "@/lib/threatlens/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invalid = requireUuidParam(id);
  if (invalid) return invalid;

  const evidence = await getEvidence(id);
  if (!evidence) {
    return Response.json({ error: "Evidence not found." }, { status: 404 });
  }

  const [ocr, verifiedText, analysis] = await Promise.all([
    getLatestOcrResult(id),
    getLatestVerifiedText(id),
    getLatestAnalysis(id),
  ]);

  const markdown = generateReportMarkdown({ evidence, ocr, verifiedText, analysis });
  await recordAuditEvent({
    action: "REPORT_GENERATED",
    correlationId: newCorrelationId(),
    evidenceId: id,
    caseId: evidence.caseId,
    details: { analysisId: analysis?.id ?? null, format: "markdown", bytes: Buffer.byteLength(markdown) },
  }).catch(() => undefined);

  return new Response(markdown, {
    status: 200,
    headers: downloadHeaders(`threatlens-report-${id}.md`, "text/markdown; charset=utf-8"),
  });
}
