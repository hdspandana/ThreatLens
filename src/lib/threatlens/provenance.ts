/**
 * Provenance helpers and the central VERSION REGISTRY.
 *
 * Every pipeline stage declares its version here (or re-exports it from
 * here) so an analysis can record exactly which code produced it. Bump a
 * version whenever the corresponding stage's behaviour changes in a way
 * that could alter outputs -- this is what makes old reports auditable.
 */
import { createHash } from "node:crypto";
import type { EpistemicStatusT, Provenance, ProvenanceSourceTypeT } from "./schemas/models";

export const VERSIONS = {
  /** Overall orchestration contract (pipeline.ts). */
  pipeline: "pipeline_v2.0.0",
  textProcessing: "text_processing_v1.1.0",
  /** Regex/lexicon rule set in analysis/signals.ts. */
  ruleSet: "rules_v1.0.0",
  riskEngine: "risk_engine_v1.1.0",
  retrievalMethod: "tfidf_cosine_v1.0.0",
  /** LLM prompt template in llm/service.ts. */
  prompt: "explain_prompt_v2.0.0",
} as const;

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable reference for a piece of text, safe to log (contains no content). */
export function textRef(text: string): string {
  return `text:sha256:${sha256Hex(text)}`;
}

export function makeProvenance(params: {
  status: EpistemicStatusT;
  sourceType: ProvenanceSourceTypeT;
  sourceId: string;
  sourceVersion?: string | null;
  confidence?: number | null;
  explanation: string;
  derivedFrom?: string[];
  timestamp?: string;
}): Provenance {
  const confidence =
    params.confidence === undefined || params.confidence === null
      ? null
      : Math.min(1, Math.max(0, params.confidence));
  return {
    status: params.status,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    sourceVersion: params.sourceVersion ?? null,
    confidence,
    timestamp: params.timestamp ?? nowIso(),
    explanation: params.explanation,
    derivedFrom: params.derivedFrom ?? [],
  };
}

/** Returns the epistemic labels present in a set of provenance records (for UI badges / reports). */
export function summarizeStatuses(items: Array<{ provenance: Provenance }>): Record<EpistemicStatusT, number> {
  const counts: Record<EpistemicStatusT, number> = {
    FOUND: 0,
    INFERRED: 0,
    RETRIEVED: 0,
    GENERATED: 0,
    UNCERTAIN: 0,
  };
  for (const item of items) counts[item.provenance.status] += 1;
  return counts;
}
