/**
 * GET /api/health
 * Liveness + configuration summary. Reports the deployed pipeline versions
 * and whether the bundled OCR language data passes integrity verification.
 * Never includes secrets or evidence data.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { describePipeline } from "@/lib/threatlens/pipeline";
import { verifyLanguageData } from "@/lib/threatlens/ocr/service";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  try {
    await db.execute(sql`select 1`);
    database = true;
  } catch {
    database = false;
  }

  let ocr: { ok: boolean; languageDataSha256: string | null; modelFamily: string | null; manifestVerified: boolean; error: string | null };
  try {
    const info = verifyLanguageData();
    ocr = { ok: true, languageDataSha256: info.sha256, modelFamily: info.modelFamily, manifestVerified: info.manifestVerified, error: null };
  } catch (err) {
    ocr = { ok: false, languageDataSha256: null, modelFamily: null, manifestVerified: false, error: err instanceof Error ? err.message : "unknown" };
  }

  const ok = database; // OCR failure degrades to manual transcription; it is reported but not fatal.
  return Response.json({ ok, database, ocr, pipeline: describePipeline() }, { status: ok ? 200 : 500 });
}
