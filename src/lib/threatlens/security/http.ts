/**
 * HTTP-layer security helpers for the Next.js route handlers.
 */
import { settings } from "../config/settings";
import { isUuid } from "./index";

/** Returns a 404 (not 400) for malformed ids so the route does not disclose id format expectations. */
export function requireUuidParam(id: string): Response | null {
  if (!isUuid(id)) {
    return Response.json({ error: "Evidence not found." }, { status: 404 });
  }
  return null;
}

/**
 * Rejects oversized uploads BEFORE the body is buffered. `request.formData()`
 * reads the whole body into memory, so relying on the post-parse size check
 * alone leaves a trivial memory-exhaustion vector. Multipart framing adds a
 * little overhead on top of the file itself, hence the small allowance.
 */
export function rejectOversizedRequest(request: Request, maxBodyBytes = settings.upload.maxSizeBytes + 64 * 1024): Response | null {
  const header = request.headers.get("content-length");
  if (header === null) return null; // chunked uploads are still bounded by validateUpload() after parsing
  const declared = Number.parseInt(header, 10);
  if (!Number.isFinite(declared) || declared < 0) {
    return Response.json({ error: "Invalid Content-Length header." }, { status: 400 });
  }
  if (declared > maxBodyBytes) {
    const maxMb = (settings.upload.maxSizeBytes / (1024 * 1024)).toFixed(1);
    return Response.json({ error: `Request exceeds the maximum allowed upload size of ${maxMb} MB.` }, { status: 413 });
  }
  return null;
}

/** Security headers applied to file-like responses (reports). */
export function downloadHeaders(filename: string, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
}
