/**
 * Replaceable classifier architecture.
 *
 * `ThreatClassifier` is the interface the rest of the app depends on, so the
 * underlying implementation can change without touching the UI or API
 * routes (dependency inversion). Only `RuleBasedClassifier` is wired into
 * the default pipeline today -- it is fully deterministic and requires no
 * external services, which keeps ThreatLens useful offline.
 */
import type { ThreatSignal } from "../schemas/models";
import { detectSignals } from "./signals";

export interface ThreatClassifier {
  readonly name: string;
  classify(normalizedText: string): Promise<ThreatSignal[]> | ThreatSignal[];
}

/** Deterministic baseline. Always available, no network/model dependency. */
export class RuleBasedClassifier implements ThreatClassifier {
  readonly name = "rule_based_v1";

  classify(normalizedText: string): ThreatSignal[] {
    return detectSignals(normalizedText);
  }
}

/**
 * Placeholder for a genuinely fine-tuned ML classifier (e.g. a fine-tuned
 * transformer for abuse/threat detection). No such trained model ships with
 * this project -- integrating one here would require a labeled training
 * dataset and a training pipeline outside this repository's scope.
 *
 * We deliberately do NOT wrap a generic base language model and call it a
 * "trained threat classifier": that would misrepresent its capability.
 * This class exists purely to document the extension point.
 */
export class MLClassifier implements ThreatClassifier {
  readonly name = "ml_classifier_unavailable";

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
