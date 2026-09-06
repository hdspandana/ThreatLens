/**
 * POST /api/evidence/:id/verify
 * Records the human-verified/corrected transcription of the evidence text.
 * This is stored separately from the raw OCR output -- raw OCR text is
 * never overwritten. Each verification is a new immutable revision.
 */
import { z } from "zod";
import { getEvidence, insertVerifiedText, recordAuditEvent } from "@/lib/threatlens/repository";
import { detectInjectionIndicators, newCorrelationId } from "@/lib/threatlens/security";
import { requireUuidParam } from "@/lib/threatlens/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  verifiedText: z.string().max(20000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invalid = requireUuidParam(id);
  if (invalid) return invalid;
  const correlationId = newCorrelationId();

  const evidence = await getEvidence(id);
  if (!evidence) {
    return Response.json({ error: "Evidence not found." }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { textSha256 } = await insertVerifiedText({ evidenceId: id, verifiedText: parsed.data.verifiedText });
  const injectionIndicators = detectInjectionIndicators(parsed.data.verifiedText);
  await recordAuditEvent({
    action: "TEXT_VERIFIED",
    correlationId,
    evidenceId: id,
    caseId: evidence.caseId,
    details: {
      textSha256,
      characterCount: parsed.data.verifiedText.length,
      injectionIndicatorCount: injectionIndicators.length,
    },
  });

  return Response.json({ ok: true, verifiedText: parsed.data.verifiedText, textSha256, injectionIndicators, correlationId });
}
