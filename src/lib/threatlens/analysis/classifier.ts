/**
 * Replaceable classifier architecture.
 *
 * `ThreatClassifier` is the interface the rest of the app depends on, so the
 * underlying implementation can change without touching the UI or API
 * routes (dependency inversion). Only `RuleBasedClassifier` is wired into
 * the default pipeline today -- it is fully deterministic and requires no
 * external services, which keeps ThreatLens useful offline.
 *
 * Phase 1 additions (contract only, no ML yet):
 *  - every classifier exposes `metadata()` (name, version, kind, category
 *    set) so analyses can record exactly which detector produced them;
 *  - `classify()` returns a `ClassificationResult` that can carry
 *    per-category probabilities once a trained model exists, while the
 *    `signals` array keeps the span-level contract the UI already uses.
 */
import type { SignalCategoryT, ThreatSignal } from "../schemas/models";
import { ALL_SIGNAL_CATEGORIES, RULE_SET_VERSION, detectSignals } from "./signals";

export type ClassifierKind = "rule_based" | "ml_model" | "ensemble";

export interface ClassifierMetadata {
  name: string;
  version: string;
  kind: ClassifierKind;
  /** Categories this classifier is able to emit. */
  categories: SignalCategoryT[];
  /** Whether outputs are calibrated probabilities (true only for evaluated ML models). */
  calibrated: boolean;
  /** Free-form, honest description of provenance/training status. */
  description: string;
}

export interface ClassificationResult {
  signals: ThreatSignal[];
  /**
   * Optional per-category scores in [0,1]. Rule-based classifiers report the
   * max matched-rule confidence per category (a heuristic, not a probability).
   */
  categoryScores: Partial<Record<SignalCategoryT, number>>;
  metadata: ClassifierMetadata;
}

export interface ThreatClassifier {
  readonly name: string;
  metadata(): ClassifierMetadata;
  classify(normalizedText: string): Promise<ClassificationResult> | ClassificationResult;
}

/** Deterministic baseline. Always available, no network/model dependency. */
export class RuleBasedClassifier implements ThreatClassifier {
  readonly name = "rule_based";

  metadata(): ClassifierMetadata {
    return {
      name: this.name,
      version: RULE_SET_VERSION,
      kind: "rule_based",
      categories: ALL_SIGNAL_CATEGORIES,
      calibrated: false,
      description:
        "Transparent regex/lexicon rule set (analysis/signals.ts). Recall-oriented baseline; confidences are hand-assigned heuristics.",
    };
  }

  classify(normalizedText: string): ClassificationResult {
    const signals = detectSignals(normalizedText);
    const categoryScores: Partial<Record<SignalCategoryT, number>> = {};
    for (const s of signals) {
      categoryScores[s.category] = Math.max(categoryScores[s.category] ?? 0, s.confidence);
    }
    return { signals, categoryScores, metadata: this.metadata() };
  }
}

/**
 * Placeholder for a genuinely fine-tuned ML classifier (e.g. a fine-tuned
 * transformer for abuse/threat detection). No such trained model ships with
 * this project -- integrating one requires the labeled dataset, training
 * pipeline, and evaluation harness planned for Phase 2.
 *
 * We deliberately do NOT wrap a generic base language model and call it a
 * "trained threat classifier": that would misrepresent its capability.
 * This class exists purely to document the extension point.
 */
export class MLClassifier implements ThreatClassifier {
  readonly name = "ml_classifier_unavailable";

  metadata(): ClassifierMetadata {
    return {
      name: this.name,
      version: "none",
      kind: "ml_model",
      categories: [],
      calibrated: false,
      description: "Not implemented: no trained model is bundled. See Phase 2 roadmap.",
    };
  }

  classify(): never {
    throw new Error(
      "MLClassifier is not implemented: no fine-tuned model ships with this project. " +
        "Use RuleBasedClassifier, or supply a trained model and implement this class."
    );
  }
}

/** Runtime-selectable classifier factory used by the analysis pipeline. */
export function getDefaultClassifier(): ThreatClassifier {
  return new RuleBasedClassifier();
}
