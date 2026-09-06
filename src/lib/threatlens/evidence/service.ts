/**
 * Evidence intake & preservation.
 *
 * Security-sensitive module. Responsibilities:
 *  - Validate uploaded files (extension, sniffed magic bytes, size).
 *  - Never trust the user-supplied filename as a filesystem path
 *    (prevents path traversal / arbitrary write).
 *  - Preserve the original bytes exactly as uploaded, in a location
 *    separate from any derived artifacts (OCR text, reports, etc.).
 *  - Compute a SHA-256 hash for INTEGRITY tracking only.
 *
 * IMPORTANT HONESTY NOTE: a SHA-256 hash proves the stored bytes have not
 * changed since ingestion (integrity). It does NOT prove the screenshot's
 * content is authentic, unedited, or not staged. That distinction is
 * surfaced in the UI and the generated report.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { settings } from "../config/settings";
import type { EvidenceRecord } from "../schemas/models";

export class EvidenceValidationError extends Error {}

interface MagicSignature {
  mime: string;
  bytes: number[];
  offset?: number;
}

// Minimal, dependency-free magic-byte sniffing for the image types we
// actually support. This defends against a malicious actor renaming an
// arbitrary file with an image extension.
const SIGNATURES: MagicSignature[] = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/bmp", bytes: [0x42, 0x4d] },
  // WEBP: "RIFF" .... "WEBP"
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

export function sniffMimeType(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    const matches = sig.bytes.every((b, i) => buffer[offset + i] === b);
    if (matches) {
      if (sig.mime === "image/webp") {
        // Confirm the WEBP marker at bytes 8-11 to avoid false positives on other RIFF files.
        const marker = buffer.subarray(8, 12).toString("ascii");
        if (marker !== "WEBP") continue;
      }
      return sig.mime;
    }
  }
  return null;
}

function extensionOf(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext;
}

/** Strips any path components and unsafe characters from a user-supplied filename, for DISPLAY ONLY. */
export function sanitizeDisplayFilename(filename: string): string {
  const base = path.basename(filename).replace(/[\u0000-\u001f]/g, "");
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 200);
  return cleaned.length > 0 ? cleaned : "unnamed_upload";
}

export interface ValidatedUpload {
  buffer: Buffer;
  declaredMimeType: string;
  detectedMimeType: string | null;
  extension: string;
  sizeBytes: number;
}

/**
 * Validates an uploaded file's extension, size, and magic bytes.
 * Throws EvidenceValidationError with a user-safe message on any failure.
 */
export function validateUpload(params: {
  buffer: Buffer;
  filename: string;
  declaredMimeType: string;
}): ValidatedUpload {
  const { buffer, filename, declaredMimeType } = params;

  if (!buffer || buffer.length === 0) {
    throw new EvidenceValidationError("Uploaded file is empty or unreadable.");
  }

  if (buffer.length > settings.upload.maxSizeBytes) {
    const maxMb = (settings.upload.maxSizeBytes / (1024 * 1024)).toFixed(1);
    throw new EvidenceValidationError(`File exceeds the maximum allowed size of ${maxMb} MB.`);
  }

  const extension = extensionOf(filename);
  if (!settings.upload.allowedExtensions.includes(extension)) {
    throw new EvidenceValidationError(
      `Unsupported file extension "${extension || "(none)"}". Allowed: ${settings.upload.allowedExtensions.join(", ")}.`
    );
  }

  const detectedMimeType = sniffMimeType(buffer);
  if (!detectedMimeType) {
    throw new EvidenceValidationError(
      "File content does not match a supported image format (malformed or disguised file)."
    );
  }

  if (!settings.upload.allowedMimeTypes.includes(detectedMimeType)) {
    throw new EvidenceValidationError(`Detected content type "${detectedMimeType}" is not allowed.`);
  }

  return {
    buffer,
    declaredMimeType,
    detectedMimeType,
    extension,
    sizeBytes: buffer.length,
  };
}

export function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function generateEvidenceId(): string {
  return randomUUID();
}

/**
 * Persists the ORIGINAL evidence bytes, unmodified, under a storage path
 * derived entirely from a server-generated UUID -- never from the
 * user-supplied filename. This is the primary path-traversal defense.
 */
export async function storeOriginalEvidence(params: {
  evidenceId: string;
  extension: string;
  buffer: Buffer;
}): Promise<string> {
  const { evidenceId, extension, buffer } = params;

  // Defense in depth: re-validate the id looks like a UUID and the
  // extension is one of our known-safe values before touching the filesystem.
  if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) {
    throw new EvidenceValidationError("Invalid evidence id.");
  }
  if (!settings.upload.allowedExtensions.includes(extension)) {
    throw new EvidenceValidationError("Invalid evidence extension.");
  }

  const dir = path.join(process.cwd(), settings.evidenceStorageDir, evidenceId);
  const resolvedRoot = path.resolve(process.cwd(), settings.evidenceStorageDir);
  const resolvedDir = path.resolve(dir);
  if (!resolvedDir.startsWith(resolvedRoot)) {
    // Should be unreachable given the UUID check above, kept as defense in depth.
    throw new EvidenceValidationError("Resolved storage path escapes the evidence root.");
  }

  await mkdir(resolvedDir, { recursive: true });
  const filePath = path.join(resolvedDir, `original${extension}`);
  await writeFile(filePath, buffer, { flag: "wx" }).catch(async (err) => {
    // wx fails if the file already exists; evidence is immutable once written.
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new EvidenceValidationError("Evidence with this id has already been stored.");
    }
    throw err;
  });

  return path.relative(process.cwd(), filePath);
}

export function buildEvidenceRecord(params: {
  id: string;
  caseId?: string | null;
  originalFilename: string;
  storedPath: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  sizeBytes: number;
  sha256: string;
}): EvidenceRecord {
  return {
    id: params.id,
    caseId: params.caseId ?? null,
    originalFilename: sanitizeDisplayFilename(params.originalFilename),
    storedPath: params.storedPath,
    declaredMimeType: params.declaredMimeType,
    detectedMimeType: params.detectedMimeType,
    sizeBytes: params.sizeBytes,
    sha256: params.sha256,
    uploadedAt: new Date().toISOString(),
  };
}
