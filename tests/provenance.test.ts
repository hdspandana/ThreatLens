import { describe, expect, it } from "vitest";
import { processText } from "@/lib/threatlens/text/processing";
import { detectSignals, listRuleIds } from "@/lib/threatlens/analysis/signals";
import { RuleBasedClassifier } from "@/lib/threatlens/analysis/classifier";
import { assessRisk } from "@/lib/threatlens/risk/scorer";
import { retrieveReferences } from "@/lib/threatlens/retrieval/service";
import { generateExplanation } from "@/lib/threatlens/llm/service";
import { makeProvenance, summarizeStatuses, textRef, VERSIONS } from "@/lib/threatlens/provenance";
import { ProvenanceSchema } from "@/lib/threatlens/schemas/models";

describe("provenance model", () => {
  it("clamps confidence into [0,1] and fills defaults", () => {
    const p = makeProvenance({ status: "INFERRED", sourceType: "RULE", sourceId: "x", confidence: 1.7, explanation: "t" });
    expect(p.confidence).toBe(1);
    expect(p.sourceVersion).toBeNull();
    expect(p.derivedFrom).toEqual([]);
    expect(ProvenanceSchema.safeParse(p).success).toBe(true);
  });

  it("textRef never contains the text itself", () => {
    const ref = textRef("I know where you live");
    expect(ref).toMatch(/^text:sha256:[0-9a-f]{64}$/);
    expect(ref).not.toContain("live");
  });
});

describe("every pipeline stage labels its epistemic status", () => {
  const text = "I know where you live. Pay me $500 or I will post your photos.";

  it("verified text is FOUND / USER_VERIFIED", () => {
    const processed = processText(text);
    expect(processed.provenance.status).toBe("FOUND");
    expect(processed.provenance.sourceType).toBe("USER_VERIFIED");
    expect(processed.provenance.sourceVersion).toBe(VERSIONS.textProcessing);
  });

  it("rule signals are INFERRED / RULE with a stable detector id and rule-set version", () => {
    const signals = detectSignals(text);
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.provenance.status).toBe("INFERRED");
      expect(s.provenance.sourceType).toBe("RULE");
      expect(s.provenance.sourceId).toBe(s.detectorId);
      expect(s.provenance.sourceVersion).toBe(VERSIONS.ruleSet);
      expect(s.provenance.confidence).toBe(s.confidence);
      expect(listRuleIds()).toContain(s.detectorId);
    }
  });

  it("rule ids are unique and never renumbered within a version", () => {
    const ids = listRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("direct_threat.01");
  });

  it("risk is INFERRED / RISK_ENGINE and records exact contributions that sum to the score", () => {
    const signals = detectSignals(text);
    const risk = assessRisk({ normalizedText: text, signals, ocrConfidence: 90 });
    expect(risk.provenance.status).toBe("INFERRED");
    expect(risk.provenance.sourceType).toBe("RISK_ENGINE");
    expect(risk.engineVersion).toBe(VERSIONS.riskEngine);
    const sum = risk.contributingFactors.reduce((acc, f) => acc + f.contribution, 0);
    expect(Math.min(10, Math.round(sum * 100) / 100)).toBeCloseTo(risk.score ?? -1, 1);
    // Risk provenance must point back at the signals it consumed.
    for (const s of signals) expect(risk.provenance.derivedFrom).toContain(`signal:${s.detectorId}@${s.startOffset}`);
  });

  it("insufficient text yields UNCERTAIN risk", () => {
    const risk = assessRisk({ normalizedText: "", signals: [], ocrConfidence: null });
    expect(risk.severity).toBe("INSUFFICIENT_INFORMATION");
    expect(risk.provenance.status).toBe("UNCERTAIN");
  });

  it("retrieved references are RETRIEVED / RETRIEVAL with a knowledge-base version", () => {
    const refs = retrieveReferences("someone is following me and watching my house");
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(r.provenance.status).toBe("RETRIEVED");
      expect(r.provenance.sourceId).toBe(`${r.documentId}#${r.chunkIndex}`);
      expect(r.knowledgeBaseVersion).toMatch(/kb_dev_v1\.0\.0\+sha256:[0-9a-f]{12}/);
    }
  });

  it("deterministic fallback is INFERRED, never GENERATED", async () => {
    const processed = processText(text);
    const { signals } = new RuleBasedClassifier().classify(processed.normalizedText);
    const risk = assessRisk({ normalizedText: processed.normalizedText, signals, ocrConfidence: null });
    const llm = await generateExplanation({ processedText: processed, signals, risk, references: [] });
    expect(llm.usedFallback).toBe(true);
    expect(llm.provenance.status).toBe("INFERRED");
    expect(llm.provenance.sourceType).toBe("DETERMINISTIC_FALLBACK");
  });

  it("summarizeStatuses counts by epistemic category", () => {
    const signals = detectSignals(text);
    const counts = summarizeStatuses(signals);
    expect(counts.INFERRED).toBe(signals.length);
    expect(counts.GENERATED).toBe(0);
  });
});
