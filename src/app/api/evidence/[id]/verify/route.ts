/**
 * POST /api/evidence/:id/verify
 * Records the human-verified/corrected transcription of the evidence text.
 * This is stored separately from the raw OCR output -- raw OCR text is
 * never overwritten.
 */
import { z } from "zod";
import { getEvidence, insertVerifiedText } from "@/lib/threatlens/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  verifiedText: z.string().max(20000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const evidence = await getEvidence(id);
  if (!evidence) {
    return Response.json({ error: "Evidence not found." }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body.", details: parsed.error.flatten() }, { status: 400 });
  }

  await insertVerifiedText({ evidenceId: id, verifiedText: parsed.data.verifiedText });
  return Response.json({ ok: true, verifiedText: parsed.data.verifiedText });
}
