/**
 * POST /api/evidence/:id/analyze
 * Runs the full deterministic analysis pipeline (text processing -> signal
 * detection -> risk scoring -> retrieval -> LLM explanation) against the
 * latest human-verified text and persists the result.
 */
import { getEvidence, getLatestOcrResult, getLatestVerifiedText, insertAnalysis } from "@/lib/threatlens/repository";
import { runAnalysisPipeline } from "@/lib/threatlens/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  try {
    const analysis = await runAnalysisPipeline({
      evidenceId: id,
      verifiedText,
      ocrConfidence: ocr?.confidence ?? null,
    });
    await insertAnalysis(analysis);
    return Response.json({ analysis });
  } catch (err) {
    console.error("Analysis pipeline failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Analysis failed unexpectedly." }, { status: 500 });
  }
}
