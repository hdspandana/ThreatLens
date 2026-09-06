/**
 * GET  /api/cases  – list cases
 * POST /api/cases  – create a case { title, description? }
 *
 * Foundation for Phase 4 case management. There is no authentication yet
 * (single local user); case-level authorization lands with auth in Phase 8.
 */
import { z } from "zod";
import { createCase, listCases, recordAuditEvent } from "@/lib/threatlens/repository";
import { errorSummary, newCorrelationId, safeLog } from "@/lib/threatlens/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
});

export async function GET() {
  try {
    return Response.json({ cases: await listCases() });
  } catch (err) {
    safeLog("error", "cases.list.failed", { error: errorSummary(err) });
    return Response.json({ error: "Failed to list cases." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const correlationId = newCorrelationId();
  const json = await request.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body.", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const created = await createCase({ title: parsed.data.title, description: parsed.data.description ?? null });
    await recordAuditEvent({ action: "CASE_CREATED", correlationId, caseId: created.id, details: { reference: created.reference } });
    return Response.json({ case: created }, { status: 201 });
  } catch (err) {
    safeLog("error", "cases.create.failed", { correlationId, error: errorSummary(err) });
    return Response.json({ error: "Failed to create case.", correlationId }, { status: 500 });
  }
}
