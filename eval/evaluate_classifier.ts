/**
 * Evaluates the deterministic RuleBasedClassifier against a small,
 * hand-labeled development dataset (data/evaluation/classifier_examples.json).
 *
 * This is a MULTI-LABEL evaluation: each example has zero or more expected
 * categories, and the classifier predicts zero or more categories (the set
 * of unique signal categories detected). We report per-category precision/
 * recall/F1, a micro-averaged summary, and a simple confusion breakdown.
 *
 * Run: npx tsx eval/evaluate_classifier.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { detectSignals } from "../src/lib/threatlens/analysis/signals";
import { ALL_SIGNAL_CATEGORIES } from "../src/lib/threatlens/analysis/signals";

interface Example {
  id: string;
  text: string;
  expectedCategories: string[];
  ambiguous?: boolean;
  note?: string;
}

const datasetPath = path.join(process.cwd(), "data/evaluation/classifier_examples.json");
const { examples } = JSON.parse(readFileSync(datasetPath, "utf-8")) as { examples: Example[] };

interface CategoryStats {
  tp: number;
  fp: number;
  fn: number;
}

const stats: Record<string, CategoryStats> = {};
for (const cat of ALL_SIGNAL_CATEGORIES) stats[cat] = { tp: 0, fp: 0, fn: 0 };

const perExampleResults: Array<{
  id: string;
  text: string;
  expected: string[];
  predicted: string[];
  correct: boolean;
  ambiguous: boolean;
}> = [];

for (const example of examples) {
  const signals = detectSignals(example.text);
  const predicted: string[] = Array.from(new Set(signals.map((s) => s.category)));
  const expectedSet = new Set<string>(example.expectedCategories);
  const predictedSet = new Set<string>(predicted);

  for (const cat of ALL_SIGNAL_CATEGORIES) {
    const inExpected = expectedSet.has(cat);
    const inPredicted = predictedSet.has(cat);
    if (inExpected && inPredicted) stats[cat].tp += 1;
    else if (!inExpected && inPredicted) stats[cat].fp += 1;
    else if (inExpected && !inPredicted) stats[cat].fn += 1;
  }

  const correct = expectedSet.size === predictedSet.size && [...expectedSet].every((c) => predictedSet.has(c));
  perExampleResults.push({
    id: example.id,
    text: example.text,
    expected: example.expectedCategories,
    predicted,
    correct,
    ambiguous: Boolean(example.ambiguous),
  });
}

function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

let totalTp = 0;
let totalFp = 0;
let totalFn = 0;
const perCategoryReport: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};

for (const [cat, s] of Object.entries(stats)) {
  totalTp += s.tp;
  totalFp += s.fp;
  totalFn += s.fn;
  const precision = safeDiv(s.tp, s.tp + s.fp);
  const recall = safeDiv(s.tp, s.tp + s.fn);
  const f1 = safeDiv(2 * precision * recall, precision + recall);
  perCategoryReport[cat] = { precision, recall, f1, support: s.tp + s.fn };
}

const microPrecision = safeDiv(totalTp, totalTp + totalFp);
const microRecall = safeDiv(totalTp, totalTp + totalFn);
const microF1 = safeDiv(2 * microPrecision * microRecall, microPrecision + microRecall);

const exactMatchAccuracy = safeDiv(
  perExampleResults.filter((r) => r.correct).length,
  perExampleResults.length
);

const report = {
  datasetNotice:
    "Small (n=" + examples.length + ") hand-written development dataset. Not representative of real-world traffic; do not present these numbers as production accuracy.",
  exactSetMatchAccuracy: Math.round(exactMatchAccuracy * 1000) / 1000,
  micro: {
    precision: Math.round(microPrecision * 1000) / 1000,
    recall: Math.round(microRecall * 1000) / 1000,
    f1: Math.round(microF1 * 1000) / 1000,
  },
  perCategory: perCategoryReport,
  perExample: perExampleResults,
};

console.log("=== ThreatLens Rule-Based Classifier Evaluation ===");
console.log(`Examples: ${examples.length}`);
console.log(`Exact category-set match accuracy: ${report.exactSetMatchAccuracy}`);
console.log(`Micro precision: ${report.micro.precision}  recall: ${report.micro.recall}  F1: ${report.micro.f1}`);
console.log("\nPer-category (only categories with support > 0 shown):");
for (const [cat, r] of Object.entries(perCategoryReport)) {
  if (r.support > 0 || r.precision + r.recall > 0) {
    console.log(`  ${cat.padEnd(28)} precision=${r.precision.toFixed(2)} recall=${r.recall.toFixed(2)} f1=${r.f1.toFixed(2)} support=${r.support}`);
  }
}
console.log("\nMisclassified examples:");
for (const r of perExampleResults.filter((r) => !r.correct)) {
  console.log(`  [${r.id}]${r.ambiguous ? " (labeled ambiguous)" : ""} "${r.text}"`);
  console.log(`     expected: [${r.expected.join(", ")}]  predicted: [${r.predicted.join(", ")}]`);
}

const outDir = path.join(process.cwd(), "eval/results");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "classifier_results.json"), JSON.stringify(report, null, 2));
console.log(`\nFull results written to eval/results/classifier_results.json`);
