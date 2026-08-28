/**
 * OCR evaluation.
 *
 * HONESTY NOTE: this project does not ship a licensed dataset of real
 * screenshots paired with verified ground-truth transcriptions, and
 * generating realistic synthetic ones (with real text embedded in a photo-
 * like image) is out of scope for this session. Running OCR evaluation
 * against fabricated/trivial images would produce a misleading accuracy
 * number, so we deliberately do NOT report one.
 *
 * What IS implemented and tested:
 *   - `characterErrorRate` / `wordErrorRate` in
 *     `src/lib/threatlens/utils/textMetrics.ts`, unit-tested in
 *     `tests/utils.textMetrics.test.ts`.
 *
 * To evaluate OCR for real, add labeled examples under
 * data/evaluation/ocr_examples/ (image + reference transcription pairs)
 * and extend this script to call `runOcr` per pair and aggregate CER/WER.
 *
 * Run: npx tsx eval/evaluate_ocr.ts
 */
import { characterErrorRate, wordErrorRate } from "../src/lib/threatlens/utils/textMetrics";

console.log("=== ThreatLens OCR Evaluation ===");
console.log(
  "LIMITATION: no licensed image+ground-truth dataset is available in this repository, so no OCR accuracy " +
    "number is reported here. See the docstring in eval/evaluate_ocr.ts and docs/evaluation.md for details."
);
console.log("\nDemonstrating the metric implementation on two illustrative (non-OCR) string pairs:");
const demoPairs: Array<[string, string]> = [
  ["I will hurt you tomorrow", "I will hurt you tomorrow"],
  ["I wiil hun you tomorow", "I will hurt you tomorrow"],
];
for (const [hyp, ref] of demoPairs) {
  console.log(
    `  hypothesis="${hyp}" reference="${ref}" -> CER=${characterErrorRate(hyp, ref).toFixed(3)} WER=${wordErrorRate(hyp, ref).toFixed(3)}`
  );
}
