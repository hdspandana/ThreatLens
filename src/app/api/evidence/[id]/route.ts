/**
 * GET /api/evidence/:id
 * Returns the full known state for one evidence item: metadata, latest OCR
 * result, latest human-verified text, and latest analysis (if any).
 */
import { getEvidence, getLatestAnalysis, getLatestOcrResult, getLatestVerifiedText } from "@/lib/threatlens/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const evidence = await getEvidence(id);
  if (!evidence) {
    return Response.json({ error: "Evidence not found." }, { status: 404 });
  }

  const [ocr, verifiedText, analysis] = await Promise.all([
    getLatestOcrResult(id),
    getLatestVerifiedText(id),
    getLatestAnalysis(id),
  ]);

  return Response.json({ evidence, ocr, verifiedText, analysis });
}
