/**
 * GET /api/evidence/:id/report
 * Generates a downloadable Markdown incident documentation report from
 * whatever pipeline stages have completed so far.
 */
import { getEvidence, getLatestAnalysis, getLatestOcrResult, getLatestVerifiedText } from "@/lib/threatlens/repository";
import { generateReportMarkdown } from "@/lib/threatlens/reporting/service";

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

  const markdown = generateReportMarkdown({ evidence, ocr, verifiedText, analysis });

  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="threatlens-report-${id}.md"`,
    },
  });
}
