/**
 * End-to-end pipeline test (no database, no network): verified text in,
 * fully-provenanced, version-stamped analysis out.
 */
import { describe, expect, it } from "vitest";
import { runAnalysisPipeline, describePipeline } from "@/lib/threatlens/pipeline";
import { AnalysisResultSchema } from "@/lib/threatlens/schemas/models";
import { RuleBasedClassifier, type ThreatClassifier } from "@/lib/threatlens/analysis/classifier";
import { VERSIONS, sha256Hex } from "@/lib/threatlens/provenance";

const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";

describe("runAnalysisPipeline", () => {
  it("produces a schema-valid analysis with versions, correlation id and input hash", async () => {
    const verifiedText = "I know where you live. If you don't pay me $300 I will post your photos unless you send it tonight.";
    const result = await runAnalysisPipeline({ evidenceId: EVIDENCE_ID, verifiedText, ocrConfidence: 82, ocrLanguageDataSha256: "d".repeat(64) });

    const parsed = AnalysisResultSchema.safeParse(result);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.flatten())).toBe(true);

    expect(result.inputTextSha256).toBe(sha256Hex(verifiedText));
    expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.pipelineVersions.pipelineVersion).toBe(VERSIONS.pipeline);
    expect(result.pipelineVersions.classifierName).toBe("rule_based");
    expect(result.pipelineVersions.classifierVersion).toBe(VERSIONS.ruleSet);
    expect(result.pipelineVersions.riskEngineVersion).toBe(VERSIONS.riskEngine);
    expect(result.pipelineVersions.promptVersion).toBe(VERSIONS.prompt);
    expect(result.pipelineVersions.ocrEngine).toBe("tesseract.js");
    expect(result.pipelineVersions.ocrLanguageDataSha256).toBe("d".repeat(64));
    expect(result.pipelineVersions.llmModel).toBeNull(); // no key configured in tests

    expect(result.signals.length).toBeGreaterThan(0);
    expect(["HIGH", "CRITICAL"]).toContain(result.risk.severity);
    expect(result.references.length).toBeGreaterThan(0);
    expect(result.llm.usedFallback).toBe(true);
  });

  it("is deterministic for identical input (excluding timestamps/ids)", async () => {
    const verifiedText = "Watch your back. I've been watching you.";
    const a = await runAnalysisPipeline({ evidenceId: EVIDENCE_ID, verifiedText, ocrConfidence: null });
    const b = await runAnalysisPipeline({ evidenceId: EVIDENCE_ID, verifiedText, ocrConfidence: null });
    const strip = (r: typeof a) => ({
      signals: r.signals.map((s) => ({ ...s, provenance: { ...s.provenance, timestamp: null } })),
      risk: { ...r.risk, provenance: { ...r.risk.provenance, timestamp: null } },
      references: r.references.map((x) => x.documentId + "#" + x.chunkIndex + ":" + x.similarity),
      input: r.inputTextSha256,
    });
    expect(strip(a)).toEqual(strip(b));
  });

  it("returns INSUFFICIENT_INFORMATION and skips retrieval for empty text", async () => {
    const result = await runAnalysisPipeline({ evidenceId: EVIDENCE_ID, verifiedText: "  ", ocrConfidence: null });
    expect(result.risk.severity).toBe("INSUFFICIENT_INFORMATION");
    expect(result.references).toEqual([]);
    expect(result.pipelineVersions.ocrEngine).toBeNull();
  });

  it("accepts an injected classifier and records its identity", async () => {
    const stub: ThreatClassifier = {
      name: "stub",
      metadata: () => ({ ...new RuleBasedClassifier().metadata(), name: "stub", version: "stub_v9" }),
      classify: () => ({ signals: [], categoryScores: {}, metadata: { ...new RuleBasedClassifier().metadata(), name: "stub", version: "stub_v9" } }),
    };
    const result = await runAnalysisPipeline({ evidenceId: EVIDENCE_ID, verifiedText: "hello there friend", ocrConfidence: null, classifier: stub });
    expect(result.pipelineVersions.classifierName).toBe("stub");
    expect(result.pipelineVersions.classifierVersion).toBe("stub_v9");
    expect(result.signals).toEqual([]);
    expect(result.risk.severity).toBe("LOW");
  });

  it("describePipeline exposes deployed versions without secrets", () => {
    const d = describePipeline();
    expect(d.pipelineVersion).toBe(VERSIONS.pipeline);
    expect(JSON.stringify(d)).not.toMatch(/sk-|apiKey/i);
  });
});
