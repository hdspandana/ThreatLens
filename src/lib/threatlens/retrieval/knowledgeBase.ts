/**
 * Loads the local reference knowledge base from disk.
 *
 * The dataset is a small, explicitly-labeled development set (see the
 * `_notice` field in the JSON file) -- not a comprehensive legal database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { settings } from "../config/settings";
import { sha256Hex } from "../provenance";

export interface KnowledgeDocument {
  id: string;
  title: string;
  source: string;
  category: string;
  content: string;
}

export interface KnowledgeChunk {
  documentId: string;
  title: string;
  source: string;
  chunkIndex: number;
  text: string;
}

let cachedDocuments: KnowledgeDocument[] | null = null;
let cachedVersion: string | null = null;

/**
 * Knowledge-base version recorded on every retrieved reference. Uses the
 * explicit `version` field from references.json when present, and always
 * appends a content hash so silent edits to the file are detectable.
 */
export function knowledgeBaseVersion(): string | null {
  if (cachedDocuments === null) loadKnowledgeBase();
  return cachedVersion;
}

export function loadKnowledgeBase(): KnowledgeDocument[] {
  if (cachedDocuments) return cachedDocuments;
  const filePath = path.join(process.cwd(), settings.retrieval.knowledgeBaseDir, "references.json");
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string; documents: KnowledgeDocument[] };
    cachedDocuments = parsed.documents ?? [];
    cachedVersion = `${parsed.version ?? "unversioned"}+sha256:${sha256Hex(raw).slice(0, 12)}`;
  } catch {
    cachedDocuments = [];
    cachedVersion = null;
  }
  return cachedDocuments;
}

/** Test helper: clears the cache so a rebuilt file is re-read. */
export function resetKnowledgeBaseCache(): void {
  cachedDocuments = null;
  cachedVersion = null;
}

/** Chunks each document into paragraph-sized pieces for finer-grained retrieval. */
export function loadKnowledgeChunks(): KnowledgeChunk[] {
  const docs = loadKnowledgeBase();
  const chunks: KnowledgeChunk[] = [];
  for (const doc of docs) {
    const paragraphs = doc.content
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    const pieces = paragraphs.length > 0 ? paragraphs : [doc.content];
    pieces.forEach((text, idx) => {
      chunks.push({ documentId: doc.id, title: doc.title, source: doc.source, chunkIndex: idx, text });
    });
  }
  return chunks;
}
