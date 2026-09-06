/**
 * OCR evaluation.
 *
 * Runs the real OCR service (tesseract.js + bundled language data) over the
 * labeled examples in data/evaluation/ocr_examples/manifest.json and
 * reports per-example and aggregate Character Error Rate (CER) and Word
 * Error Rate (WER), plus the engine's self-reported confidence.
 *
 * HONESTY NOTE: the bundled examples are synthetic, cleanly rendered text
 * images. They verify that the OCR pipeline WORKS end-to-end and give a
 * regression baseline; they do not represent real-world screenshot
 * difficulty. Add real, consented, labeled screenshots to the manifest to
 * obtain meaningful accuracy numbers.
 *
 * Run: npx tsx eval/evaluate_ocr.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { characterErrorRate, wordErrorRate } from "../src/lib/threatlens/utils/textMetrics";
import { runOcr, terminateOcrWorker, verifyLanguageData, OCR_ENGINE_VERSION } from "../src/lib/threatlens/ocr/service";

interface Example {
  id: string;
  file: string;
  reference: string;
}

function normalizeForComparison(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function main() {
  const dir = path.join(process.cwd(), "data/evaluation/ocr_examples");
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf-8")) as { _notice: string; examples: Example[] };

  console.log("=== ThreatLens OCR Evaluation ===");
  const langInfo = verifyLanguageData();
  console.log(`Engine: tesseract.js ${OCR_ENGINE_VERSION}`);
  console.log(`Language data: ${langInfo.fileName} (${langInfo.modelFamily ?? "unknown family"}) sha256=${langInfo.sha256.slice(0, 16)}… manifestVerified=${langInfo.manifestVerified}`);
  console.log(`Examples: ${manifest.examples.length}`);
  console.log(`LIMITATION: ${manifest._notice}\n`);

  const perExample: Array<{
    id: string;
    succeeded: boolean;
    confidence: number | null;
    cer: number;
    wer: number;
    latencyMs: number;
  }> = [];

  for (const ex of manifest.examples) {
    const buffer = readFileSync(path.join(dir, ex.file));
    const started = Date.now();
    const result = await runOcr({ evidenceId: "00000000-0000-4000-8000-000000000000", imageBuffer: buffer });
    const latencyMs = Date.now() - started;
    const hyp = normalizeForComparison(result.rawText);
    const ref = normalizeForComparison(ex.reference);
    const cer = characterErrorRate(hyp, ref);
    const wer = wordErrorRate(hyp, ref);
    perExample.push({ id: ex.id, succeeded: result.succeeded, confidence: result.confidence, cer, wer, latencyMs });
    console.log(
      `  [${ex.id}] succeeded=${result.succeeded} confidence=${result.confidence?.toFixed(1) ?? "n/a"} CER=${cer.toFixed(3)} WER=${wer.toFixed(3)} latency=${latencyMs}ms`
    );
    if (cer > 0) {
      console.log(`      ref: "${ref}"`);
      console.log(`      hyp: "${hyp}"`);
    }
  }

  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const report = {
    datasetNotice: manifest._notice,
    engine: `tesseract.js ${OCR_ENGINE_VERSION}`,
    languageDataSha256: langInfo.sha256,
    examples: perExample.length,
    meanCer: Math.round(mean(perExample.map((e) => e.cer)) * 1000) / 1000,
    meanWer: Math.round(mean(perExample.map((e) => e.wer)) * 1000) / 1000,
    meanConfidence: Math.round(mean(perExample.filter((e) => e.confidence !== null).map((e) => e.confidence as number)) * 10) / 10,
    meanLatencyMs: Math.round(mean(perExample.map((e) => e.latencyMs))),
    perExample,
    generatedAt: new Date().toISOString(),
  };

  console.log(`\nMean CER: ${report.meanCer}  Mean WER: ${report.meanWer}  Mean confidence: ${report.meanConfidence}  Mean latency: ${report.meanLatencyMs}ms`);

  const outDir = path.join(process.cwd(), "eval/results");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "ocr_results.json"), JSON.stringify(report, null, 2));
  console.log("Full results written to eval/results/ocr_results.json");

  await terminateOcrWorker();
}

main().catch(async (err) => {
  console.error("OCR evaluation failed:", err instanceof Error ? err.message : err);
  await terminateOcrWorker().catch(() => undefined);
  process.exit(1);
});
