/**
 * OCR service.
 *
 * Uses tesseract.js (a real, local OCR engine -- no image bytes ever leave
 * the machine for this step) against a bundled trained-data file so the
 * pipeline does not depend on reaching an external CDN at request time.
 *
 * OCR output is explicitly NOT treated as ground truth anywhere downstream:
 * `rawText` is preserved untouched, and the UI requires a human
 * verification step before analysis runs on the text.
 *
 * Phase 1 hardening notes (see docs/audit_phase1.md):
 *  - The previously bundled eng.traineddata was corrupt (binary passed
 *    through a UTF-8 text encoder) so OCR could never initialise. It has
 *    been replaced by the genuine tessdata_fast model, gzipped, and pinned
 *    in data/tessdata/MANIFEST.json.
 *  - The worker previously used the bundled directory as its *cache*
 *    directory. tesseract.js deletes cached language files when
 *    initialisation fails, which deleted the bundled model. Caching is now
 *    disabled entirely; the bundled file is treated as read-only input.
 *  - The language data file is hash-verified against the manifest before
 *    the worker starts, and the hash is recorded on every OcrResult.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import tesseractPackage from "tesseract.js/package.json";
import { settings } from "../config/settings";
import { makeProvenance, sha256Hex } from "../provenance";
import type { OcrRegion, OcrResult } from "../schemas/models";

export const OCR_ENGINE = "tesseract.js" as const;

interface ManifestEntry {
  language: string;
  sha256Gzipped: string;
  sha256Uncompressed: string;
  modelFamily: string;
}

interface LanguageDataInfo {
  /** Directory passed to tesseract.js as `langPath`. */
  langPath: string;
  fileName: string;
  gzip: boolean;
  /** SHA-256 of the on-disk file (gzipped form if gzipped). */
  sha256: string;
  modelFamily: string | null;
  manifestVerified: boolean;
}

export class OcrLanguageDataError extends Error {}

/** Static import keeps the bundler's file tracing scoped (no dynamic require). */
export const OCR_ENGINE_VERSION: string = (tesseractPackage as { version?: string }).version ?? "unknown";

let languageDataInfo: LanguageDataInfo | null = null;

/**
 * Locates and integrity-checks the bundled language data. Throws
 * OcrLanguageDataError if the file is missing or does not match the
 * manifest -- we would rather fail loudly than run OCR on a tampered model.
 * Exported for tests and for the health endpoint.
 */
export function verifyLanguageData(): LanguageDataInfo {
  if (languageDataInfo) return languageDataInfo;

  const dir = path.join(process.cwd(), settings.ocrLangDataDir);
  const lang = settings.ocrLanguage;
  const manifestPath = path.join(dir, "MANIFEST.json");

  let manifest: Record<string, ManifestEntry> = {};
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as { files?: Record<string, ManifestEntry> };
    manifest = parsed.files ?? {};
  } catch {
    manifest = {};
  }

  const candidates: Array<{ fileName: string; gzip: boolean }> = [
    { fileName: `${lang}.traineddata.gz`, gzip: true },
    { fileName: `${lang}.traineddata`, gzip: false },
  ];

  for (const candidate of candidates) {
    const filePath = path.join(dir, candidate.fileName);
    let bytes: Buffer;
    try {
      bytes = readFileSync(filePath);
    } catch {
      continue;
    }
    const sha256 = sha256Hex(bytes);
    const entry = manifest[candidate.fileName];
    if (entry) {
      const expected = candidate.gzip ? entry.sha256Gzipped : entry.sha256Uncompressed;
      if (expected !== sha256) {
        throw new OcrLanguageDataError(
          `OCR language data ${candidate.fileName} failed integrity verification against MANIFEST.json ` +
            `(expected ${expected.slice(0, 12)}…, got ${sha256.slice(0, 12)}…). Refusing to start OCR.`
        );
      }
    }
    // Basic structural sanity: tesseract traineddata begins with a little-endian
    // entry count; a UTF-8-mangled file shows the 0xEF 0xBF 0xBD replacement sequence.
    if (!candidate.gzip && bytes.length >= 8 && bytes[4] === 0xef && bytes[5] === 0xbf && bytes[6] === 0xbd) {
      throw new OcrLanguageDataError(
        `OCR language data ${candidate.fileName} appears to be corrupted (UTF-8 replacement bytes detected).`
      );
    }
    languageDataInfo = {
      langPath: dir,
      fileName: candidate.fileName,
      gzip: candidate.gzip,
      sha256,
      modelFamily: entry?.modelFamily ?? null,
      manifestVerified: Boolean(entry),
    };
    return languageDataInfo;
  }

  throw new OcrLanguageDataError(
    `No OCR language data found for "${lang}" under ${settings.ocrLangDataDir} (expected ${lang}.traineddata.gz or ${lang}.traineddata).`
  );
}

let workerPromise: Promise<Worker> | null = null;

/** Lazily creates (and reuses) a single tesseract worker for the process lifetime. */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const info = verifyLanguageData();
    workerPromise = createWorker(settings.ocrLanguage, 1, {
      langPath: info.langPath,
      gzip: info.gzip,
      // Never let tesseract.js write to or delete from our bundled data directory.
      cacheMethod: "none",
      logger: () => {
        /* intentionally silent: avoid logging potentially sensitive progress payloads */
      },
      // Without an errorHandler, tesseract.js re-throws recognize() failures
      // as an unhandled exception in addition to rejecting the promise,
      // which can crash the Node process on a malformed/corrupt image.
      // We handle failures via the rejected promise in runOcr() instead.
      errorHandler: () => {},
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Allows tests / shutdown scripts to release the tesseract worker. */
export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise.catch(() => null);
    if (worker) await worker.terminate();
    workerPromise = null;
  }
}

function baseResult(evidenceId: string, createdAt: string, languageDataSha256: string | null): Omit<OcrResult, "provenance"> {
  return {
    evidenceId,
    engine: OCR_ENGINE,
    engineVersion: OCR_ENGINE_VERSION,
    language: settings.ocrLanguage,
    languageDataSha256,
    rawText: "",
    confidence: null,
    regions: [],
    warnings: [],
    succeeded: false,
    errorMessage: null,
    createdAt,
  };
}

export async function runOcr(params: { evidenceId: string; imageBuffer: Buffer; evidenceSha256?: string }): Promise<OcrResult> {
  const { evidenceId, imageBuffer, evidenceSha256 } = params;
  const createdAt = new Date().toISOString();
  const derivedFrom = evidenceSha256 ? [`evidence:sha256:${evidenceSha256}`] : [`evidence:${evidenceId}`];

  if (!settings.featureFlags.ocrEnabled) {
    return {
      ...baseResult(evidenceId, createdAt, null),
      warnings: ["OCR is disabled via configuration (THREATLENS_OCR_ENABLED=false). Manual transcription required."],
      provenance: makeProvenance({
        status: "UNCERTAIN",
        sourceType: "OCR",
        sourceId: OCR_ENGINE,
        sourceVersion: OCR_ENGINE_VERSION,
        confidence: null,
        explanation: "OCR was disabled; no text was extracted.",
        derivedFrom,
        timestamp: createdAt,
      }),
    };
  }

  let languageDataSha256: string | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    languageDataSha256 = verifyLanguageData().sha256;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`OCR timed out after ${settings.ocrTimeoutMs} ms`)), settings.ocrTimeoutMs);
    });
    const recognition = (async () => {
      const worker = await getWorker();
      return worker.recognize(imageBuffer);
    })();
    const result = await Promise.race([recognition, timeoutPromise]);
    const data = result.data;

    const warnings: string[] = [];
    const confidence = typeof data.confidence === "number" ? data.confidence : null;
    if (confidence !== null && confidence < settings.ocrLowConfidenceThreshold) {
      warnings.push(
        `Low OCR confidence (${confidence.toFixed(1)}%). Please carefully verify the extracted text before analysis.`
      );
    }
    if (!data.text || data.text.trim().length === 0) {
      warnings.push("No text was detected in the image. You can still enter text manually.");
    }

    const regions: OcrRegion[] = (data.words ?? []).map((word) => ({
      text: word.text,
      confidence: word.confidence,
      bbox: {
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1,
      },
    }));

    return {
      ...baseResult(evidenceId, createdAt, languageDataSha256),
      rawText: data.text ?? "",
      confidence,
      regions,
      warnings,
      succeeded: true,
      provenance: makeProvenance({
        status: "FOUND",
        sourceType: "OCR",
        sourceId: OCR_ENGINE,
        sourceVersion: `${OCR_ENGINE_VERSION}+${settings.ocrLanguage}@${languageDataSha256.slice(0, 12)}`,
        confidence: confidence === null ? null : confidence / 100,
        explanation:
          "Text extracted locally from the evidence image by tesseract.js. Raw output; requires human verification.",
        derivedFrom,
        timestamp: createdAt,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown OCR failure.";
    if (/timed out/.test(message)) {
      // A hung worker is not reusable; drop it so the next request starts fresh.
      const stale = workerPromise;
      workerPromise = null;
      stale?.then((w) => w.terminate()).catch(() => undefined);
    }
    return {
      ...baseResult(evidenceId, createdAt, languageDataSha256),
      errorMessage: `OCR failed: ${message}. You can still enter the message text manually below.`,
      provenance: makeProvenance({
        status: "UNCERTAIN",
        sourceType: "OCR",
        sourceId: OCR_ENGINE,
        sourceVersion: OCR_ENGINE_VERSION,
        confidence: null,
        explanation: "OCR failed; no text was extracted.",
        derivedFrom,
        timestamp: createdAt,
      }),
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
