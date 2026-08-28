/**
 * Loads the local reference knowledge base from disk.
 *
 * The dataset is a small, explicitly-labeled development set (see the
 * `_notice` field in the JSON file) -- not a comprehensive legal database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { settings } from "../config/settings";

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

export function loadKnowledgeBase(): KnowledgeDocument[] {
  if (cachedDocuments) return cachedDocuments;
  const filePath = path.join(process.cwd(), settings.retrieval.knowledgeBaseDir, "references.json");
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { documents: KnowledgeDocument[] };
    cachedDocuments = parsed.documents ?? [];
  } catch {
    cachedDocuments = [];
  }
  return cachedDocuments;
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
