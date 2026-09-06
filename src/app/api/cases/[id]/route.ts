/**
 * GET /api/cases/:id – case record plus its evidence inventory.
 */
import { getCase, listEvidenceForCase } from "@/lib/threatlens/repository";
import { isUuid } from "@/lib/threatlens/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Case not found." }, { status: 404 });
  const record = await getCase(id);
  if (!record) return Response.json({ error: "Case not found." }, { status: 404 });
  const evidence = await listEvidenceForCase(id);
  return Response.json({ case: record, evidence });
}
