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
 */
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import { settings } from "../config/settings";
import type { OcrRegion, OcrResult } from "../schemas/models";

let workerPromise: Promise<Worker> | null = null;

/** Lazily creates (and reuses) a single tesseract worker for the process lifetime. */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const langDataDir = path.join(process.cwd(), settings.ocrLangDataDir);
    workerPromise = createWorker(settings.ocrLanguage, 1, {
      langPath: langDataDir,
      gzip: true,
      cachePath: langDataDir,
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
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

export async function runOcr(params: { evidenceId: string; imageBuffer: Buffer }): Promise<OcrResult> {
  const { evidenceId, imageBuffer } = params;
  const createdAt = new Date().toISOString();

  if (!settings.featureFlags.ocrEnabled) {
    return {
      evidenceId,
      engine: "tesseract.js",
      language: settings.ocrLanguage,
      rawText: "",
      confidence: null,
      regions: [],
      warnings: ["OCR is disabled via configuration (THREATLENS_OCR_ENABLED=false). Manual transcription required."],
      succeeded: false,
      errorMessage: null,
      createdAt,
    };
  }

  try {
    const worker = await getWorker();
    const result = await worker.recognize(imageBuffer);
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
      evidenceId,
      engine: "tesseract.js",
      language: settings.ocrLanguage,
      rawText: data.text ?? "",
      confidence,
      regions,
      warnings,
      succeeded: true,
      errorMessage: null,
      createdAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown OCR failure.";
    return {
      evidenceId,
      engine: "tesseract.js",
      language: settings.ocrLanguage,
      rawText: "",
      confidence: null,
      regions: [],
      warnings: [],
      succeeded: false,
      errorMessage: `OCR failed: ${message}. You can still enter the message text manually below.`,
      createdAt,
    };
  }
}
