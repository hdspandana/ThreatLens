/**
 * Evaluates the local TF-IDF retrieval layer against a small hand-labeled
 * query -> relevant-document-id dataset.
 *
 * Metric: recall@k -- for each query, whether at least one of the labeled
 * relevant documents appears within the top-k retrieved chunks.
 *
 * Run: npx tsx eval/evaluate_retrieval.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { retrieveReferences } from "../src/lib/threatlens/retrieval/service";

interface Example {
  query: string;
  relevantDocumentIds: string[];
}

const K = 3;
const datasetPath = path.join(process.cwd(), "data/evaluation/retrieval_examples.json");
const { examples } = JSON.parse(readFileSync(datasetPath, "utf-8")) as { examples: Example[] };

let hits = 0;
const perExample = examples.map((example) => {
  const results = retrieveReferences(example.query, K);
  const retrievedIds = results.map((r) => r.documentId);
  const hit = example.relevantDocumentIds.some((id) => retrievedIds.includes(id));
  if (hit) hits += 1;
  return { query: example.query, expected: example.relevantDocumentIds, retrieved: retrievedIds, hit };
});

const recallAtK = examples.length === 0 ? 0 : hits / examples.length;

console.log(`=== ThreatLens Retrieval Evaluation (recall@${K}) ===`);
console.log(`Examples: ${examples.length}`);
console.log(`recall@${K}: ${Math.round(recallAtK * 1000) / 1000}`);
console.log("\nPer-query detail:");
for (const r of perExample) {
  console.log(`  [${r.hit ? "HIT " : "MISS"}] "${r.query}"`);
  console.log(`         expected=[${r.expected.join(", ")}] retrieved=[${r.retrieved.join(", ")}]`);
}

const outDir = path.join(process.cwd(), "eval/results");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "retrieval_results.json"),
  JSON.stringify({ k: K, recallAtK: Math.round(recallAtK * 1000) / 1000, perExample }, null, 2)
);
console.log(`\nFull results written to eval/results/retrieval_results.json`);
