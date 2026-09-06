import { describe, expect, it } from "vitest";
import { generateReportMarkdown } from "@/lib/threatlens/reporting/service";
import {
  analysisFixture,
  evidenceFixture,
  llmFixture,
  ocrFixture,
  processedTextFixture,
  referenceFixture,
  riskFixture,
  signalFixture,
} from "./fixtures";

const evidence = evidenceFixture({ sizeBytes: 1024 });
const ocr = ocrFixture({ rawText: "raw ocr text", confidence: 55, warnings: ["Low OCR confidence"] });
const analysis = analysisFixture({
  processedText: processedTextFixture("verified text"),
  signals: [signalFixture({ evidenceSpan: "I will hurt you", endOffset: 16, confidence: 0.9, explanation: "explicit threat" })],
  risk: riskFixture({
    score: 6.5,
    contributingFactors: [{ category: "direct_threat", weight: 3, count: 1, contribution: 2.7, description: "1 direct_threat signal" }],
    explanation: "Detected 1 signal.",
  }),
  references: [referenceFixture({ source: "dev dataset", snippet: "...", similarity: 0.2 })],
  llm: llmFixture({ summary: "fallback summary" }),
});

describe("generateReportMarkdown", () => {
  it("includes a non-legal disclaimer", () => {
    const md = generateReportMarkdown({ evidence, ocr, verifiedText: "verified text", analysis });
    expect(md).toMatch(/not.*official legal document/i);
  });

  it("includes the SHA-256 and clarifies it is integrity, not authenticity", () => {
    const md = generateReportMarkdown({ evidence, ocr, verifiedText: null, analysis: null });
    expect(md).toContain(evidence.sha256);
    expect(md.toLowerCase()).toContain("not");
    expect(md.toLowerCase()).toContain("authentic");
  });

  it("includes raw OCR text separately from verified text", () => {
    const md = generateReportMarkdown({ evidence, ocr, verifiedText: "the corrected version", analysis: null });
    expect(md).toContain("raw ocr text");
    expect(md).toContain("the corrected version");
  });

  it("handles missing analysis gracefully", () => {
    const md = generateReportMarkdown({ evidence, ocr: null, verifiedText: null, analysis: null });
    expect(md).toMatch(/has not been run/i);
  });

  it("includes detected signals and severity when analysis is present", () => {
    const md = generateReportMarkdown({ evidence, ocr, verifiedText: "verified text", analysis });
    expect(md).toContain("direct_threat");
    expect(md).toContain("HIGH");
  });
});
