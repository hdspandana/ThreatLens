/**
 * GET /api/evidence/:id/audit
 * Returns the append-only, content-free audit trail for an evidence item.
 */
import { getEvidence, listAuditEventsForEvidence } from "@/lib/threatlens/repository";
import { requireUuidParam } from "@/lib/threatlens/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invalid = requireUuidParam(id);
  if (invalid) return invalid;

  const evidence = await getEvidence(id);
  if (!evidence) return Response.json({ error: "Evidence not found." }, { status: 404 });

  const events = await listAuditEventsForEvidence(id);
  return Response.json({ events });
}
