/**
 * Local semantic-ish retrieval layer.
 *
 * DESIGN NOTE: a native vector database such as FAISS is not available in
 * this Node.js/Next.js runtime without a native binary dependency that
 * would complicate deployment. Instead, this module implements TF-IDF
 * weighted bag-of-words vectors with cosine similarity -- a real, fully
 * local, dependency-free "vector index" over the knowledge base. It runs
 * entirely offline and requires no API key, which keeps retrieval
 * independent of the LLM layer as required.
 *
 * If a true embedding-based index is desired later, this module's public
 * function signature (`retrieveReferences`) is the only integration point
 * the rest of the app depends on, so the implementation can be swapped.
 */
import { settings } from "../config/settings";
import { knowledgeBaseVersion, loadKnowledgeChunks, type KnowledgeChunk } from "./knowledgeBase";
import type { RetrievedReference } from "../schemas/models";
import { makeProvenance, VERSIONS, textRef } from "../provenance";

export const RETRIEVAL_METHOD_VERSION = VERSIONS.retrievalMethod;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "is", "are", "was", "were", "be", "been", "to", "of", "in",
  "on", "for", "with", "that", "this", "it", "as", "by", "at", "from", "your", "you", "i",
  "if", "not", "can", "will", "has", "have", "had", "but", "or", "so", "do", "does",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface IndexedChunk {
  chunk: KnowledgeChunk;
  termFreq: Map<string, number>;
  norm: number;
}

interface TfIdfIndex {
  idf: Map<string, number>;
  chunks: IndexedChunk[];
}

let cachedIndex: TfIdfIndex | null = null;

function buildIndex(): TfIdfIndex {
  const chunks = loadKnowledgeChunks();
  const docFrequency = new Map<string, number>();
  const tokenizedChunks = chunks.map((chunk) => {
    const tokens = tokenize(chunk.text);
    const termFreq = new Map<string, number>();
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    for (const term of termFreq.keys()) docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    return { chunk, termFreq };
  });

  const totalChunks = Math.max(1, chunks.length);
  const idf = new Map<string, number>();
  for (const [term, df] of docFrequency.entries()) {
    idf.set(term, Math.log((totalChunks + 1) / (df + 1)) + 1);
  }

  const indexedChunks: IndexedChunk[] = tokenizedChunks.map(({ chunk, termFreq }) => {
    let normSq = 0;
    for (const [term, tf] of termFreq.entries()) {
      const weight = tf * (idf.get(term) ?? 0);
      normSq += weight * weight;
    }
    return { chunk, termFreq, norm: Math.sqrt(normSq) };
  });

  return { idf, chunks: indexedChunks };
}

function getIndex(): TfIdfIndex {
  if (!cachedIndex) cachedIndex = buildIndex();
  return cachedIndex;
}

/** Exposed for tests that need to rebuild the index after mutating the knowledge base. */
export function _resetRetrievalIndexCache(): void {
  cachedIndex = null;
}

function cosineSimilarity(queryTerms: Map<string, number>, idf: Map<string, number>, chunk: IndexedChunk): number {
  let dot = 0;
  let queryNormSq = 0;
  for (const [term, qtf] of queryTerms.entries()) {
    const weight = qtf * (idf.get(term) ?? 0);
    queryNormSq += weight * weight;
    const chunkTf = chunk.termFreq.get(term);
    if (chunkTf) {
      dot += weight * (chunkTf * (idf.get(term) ?? 0));
    }
  }
  const queryNorm = Math.sqrt(queryNormSq);
  if (queryNorm === 0 || chunk.norm === 0) return 0;
  return dot / (queryNorm * chunk.norm);
}

export function retrieveReferences(query: string, topK: number = settings.retrieval.topK): RetrievedReference[] {
  if (!settings.featureFlags.retrievalEnabled) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { idf, chunks } = getIndex();
  if (chunks.length === 0) return [];

  const queryTokens = tokenize(trimmed);
  const queryTermFreq = new Map<string, number>();
  for (const t of queryTokens) queryTermFreq.set(t, (queryTermFreq.get(t) ?? 0) + 1);

  const scored = chunks
    .map((c) => ({ chunk: c.chunk, similarity: cosineSimilarity(queryTermFreq, idf, c) }))
    .filter((r) => r.similarity >= settings.retrieval.minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  const kbVersion = knowledgeBaseVersion();
  const queryRef = textRef(trimmed);
  return scored.map(({ chunk, similarity }) => {
    const rounded = Math.round(similarity * 1000) / 1000;
    return {
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      title: chunk.title,
      source: chunk.source,
      snippet: chunk.text.length > 400 ? `${chunk.text.slice(0, 400)}…` : chunk.text,
      similarity: rounded,
      knowledgeBaseVersion: kbVersion,
      provenance: makeProvenance({
        status: "RETRIEVED",
        sourceType: "RETRIEVAL",
        sourceId: `${chunk.documentId}#${chunk.chunkIndex}`,
        sourceVersion: kbVersion,
        confidence: Math.min(1, rounded),
        explanation: `Local TF-IDF cosine match (${RETRIEVAL_METHOD_VERSION}) against the bundled reference dataset; similarity is lexical, not a relevance guarantee.`,
        derivedFrom: [queryRef],
      }),
    };
  });
}
