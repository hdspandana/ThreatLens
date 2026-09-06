/**
 * Risk / severity engine.
 *
 * Produces an interpretable severity level from detected signals. The
 * scoring model is deliberately simple and fully documented rather than a
 * black-box weighted formula presented as "scientific":
 *
 *   1. Each signal CATEGORY has a fixed severity TIER (1, 2, or 3) reflecting
 *      how serious that category is when present at all (see CATEGORY_TIER).
 *   2. Each individual signal contributes `tier * confidence` to the score.
 *   3. Contributions are summed per category, then the categories'
 *      contributions are summed into a single score, capped at 10.
 *   4. The final score is mapped to LOW/MEDIUM/HIGH/CRITICAL using
 *      configurable thresholds (see config/settings.ts).
 *
 * This is an ordinal heuristic, not a validated statistical model. It is
 * meant to be transparent and auditable, not maximally "accurate" -- there
 * is no ground-truth severity dataset to fit against.
 */
import { settings } from "../config/settings";
import type { RiskAssessment, SeverityLevelT, SignalCategoryT, ThreatSignal } from "../schemas/models";
import { makeProvenance, VERSIONS, textRef } from "../provenance";

export const RISK_ENGINE_VERSION = VERSIONS.riskEngine;

/** Documented severity tier per category (3 = most severe class of harm). */
const CATEGORY_TIER: Record<SignalCategoryT, number> = {
  direct_threat: 3,
  extortion: 3,
  blackmail: 3,
  coercion: 2.5,
  stalking: 2.5,
  sexual_harassment: 2.5,
  intimidation: 2,
  hate_abusive_language: 1.5,
  impersonation: 1.5,
  harassment: 1.5,
  repeated_unwanted_contact: 1,
  suspicious_demand: 1,
};

function severityFromScore(score: number): SeverityLevelT {
  if (score >= settings.risk.criticalThreshold) return "CRITICAL";
  if (score >= settings.risk.highThreshold) return "HIGH";
  if (score >= settings.risk.mediumThreshold) return "MEDIUM";
  return "LOW";
}

export function assessRisk(params: { normalizedText: string; signals: ThreatSignal[]; ocrConfidence: number | null }): RiskAssessment {
  const { normalizedText, signals, ocrConfidence } = params;

  const derivedFrom = [textRef(normalizedText), ...signals.map((s) => `signal:${s.detectorId}@${s.startOffset}`)];

  if (normalizedText.trim().length < settings.risk.minTextLengthForAssessment) {
    return {
      severity: "INSUFFICIENT_INFORMATION",
      score: null,
      contributingFactors: [],
      uncertainty: {
        level: "HIGH",
        reasons: ["Verified text is too short or empty to perform a meaningful risk assessment."],
      },
      explanation:
        "There is not enough verified text to assess risk. Please verify/enter the message content before analyzing.",
      engineVersion: RISK_ENGINE_VERSION,
      provenance: makeProvenance({
        status: "UNCERTAIN",
        sourceType: "RISK_ENGINE",
        sourceId: "risk_scorer",
        sourceVersion: RISK_ENGINE_VERSION,
        confidence: null,
        explanation: "Insufficient verified text; no score computed.",
        derivedFrom,
      }),
    };
  }

  const byCategory = new Map<SignalCategoryT, ThreatSignal[]>();
  for (const s of signals) {
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }

  const contributingFactors: RiskAssessment["contributingFactors"] = [];
  let score = 0;
  for (const [category, matches] of byCategory.entries()) {
    const tier = CATEGORY_TIER[category] ?? 1;
    const categoryContribution = matches.reduce((sum, m) => sum + tier * m.confidence, 0);
    score += categoryContribution;
    contributingFactors.push({
      category,
      weight: tier,
      count: matches.length,
      contribution: Math.round(categoryContribution * 100) / 100,
      description: `${matches.length} ${category.replace(/_/g, " ")} signal(s) detected, severity tier ${tier}.`,
    });
  }

  // Cap the score to keep it on an interpretable 0-10 scale.
  const cappedScore = Math.min(10, Math.round(score * 100) / 100);
  const severity = signals.length === 0 ? "LOW" : severityFromScore(cappedScore);

  // Uncertainty is surfaced explicitly rather than folded into the score.
  const uncertaintyReasons: string[] = [];
  if (ocrConfidence !== null && ocrConfidence < settings.ocrLowConfidenceThreshold) {
    uncertaintyReasons.push("OCR confidence was low; verify the transcribed text is accurate.");
  }
  if (signals.length > 0 && signals.every((s) => s.confidence < 0.5)) {
    uncertaintyReasons.push("All detected signals have low individual confidence.");
  }
  if (normalizedText.trim().split(/\s+/).length < 8) {
    uncertaintyReasons.push("The message is very short, limiting the context available for assessment.");
  }
  const uncertaintyLevel = uncertaintyReasons.length >= 2 ? "HIGH" : uncertaintyReasons.length === 1 ? "MEDIUM" : "LOW";

  const explanation =
    signals.length === 0
      ? "No rule-based threat/abuse signals were detected in the verified text. This does not guarantee the content is safe -- it means the current deterministic detectors found no matches."
      : `Detected ${signals.length} signal(s) across ${byCategory.size} categor${byCategory.size === 1 ? "y" : "ies"}. ` +
        `Severity "${severity}" was derived from a documented, non-ML scoring heuristic (see risk/scorer.ts) applied to those signals, not from a legal determination.`;

  return {
    severity,
    score: cappedScore,
    contributingFactors,
    uncertainty: { level: uncertaintyLevel, reasons: uncertaintyReasons },
    explanation,
    engineVersion: RISK_ENGINE_VERSION,
    provenance: makeProvenance({
      status: "INFERRED",
      sourceType: "RISK_ENGINE",
      sourceId: "risk_scorer",
      sourceVersion: RISK_ENGINE_VERSION,
      confidence: null,
      explanation:
        "Documented additive heuristic: sum over categories of (severity tier x rule confidence), capped at 10, mapped to thresholds. Not a calibrated or validated model.",
      derivedFrom,
    }),
  };
}
