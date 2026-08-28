import { describe, expect, it } from "vitest";
import { assessRisk } from "@/lib/threatlens/risk/scorer";
import { detectSignals } from "@/lib/threatlens/analysis/signals";

describe("assessRisk", () => {
  it("returns INSUFFICIENT_INFORMATION for empty/too-short text", () => {
    const result = assessRisk({ normalizedText: "hi", signals: [], ocrConfidence: null });
    expect(result.severity).toBe("INSUFFICIENT_INFORMATION");
    expect(result.score).toBeNull();
  });

  it("returns LOW severity when no signals are detected in sufficient text", () => {
    const text = "Hey, are we still meeting for lunch tomorrow afternoon?";
    const result = assessRisk({ normalizedText: text, signals: [], ocrConfidence: null });
    expect(result.severity).toBe("LOW");
  });

  it("escalates severity as more severe signals are present", () => {
    const mild = "You're annoying and I keep texting you every day.";
    const severe = "I will kill you tonight. I know where you live and I have a gun.";

    const mildResult = assessRisk({ normalizedText: mild, signals: detectSignals(mild), ocrConfidence: null });
    const severeResult = assessRisk({ normalizedText: severe, signals: detectSignals(severe), ocrConfidence: null });

    const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    expect(order.indexOf(severeResult.severity)).toBeGreaterThanOrEqual(order.indexOf(mildResult.severity));
  });

  it("surfaces uncertainty when OCR confidence is low", () => {
    const text = "I will hurt you badly tomorrow at school.";
    const result = assessRisk({ normalizedText: text, signals: detectSignals(text), ocrConfidence: 20 });
    expect(result.uncertainty.reasons.join(" ")).toMatch(/OCR confidence/);
  });

  it("includes contributing factors for each detected category", () => {
    const text = "Pay me $500 or I will post those photos unless you send the money today.";
    const signals = detectSignals(text);
    const result = assessRisk({ normalizedText: text, signals, ocrConfidence: null });
    expect(result.contributingFactors.length).toBeGreaterThan(0);
    expect(result.contributingFactors.some((f) => f.category === "extortion")).toBe(true);
  });

  it("never claims a legal conclusion in its explanation", () => {
    const text = "I will kill you.";
    const result = assessRisk({ normalizedText: text, signals: detectSignals(text), ocrConfidence: null });
    expect(result.explanation.toLowerCase()).not.toContain("guilty");
    expect(result.explanation.toLowerCase()).not.toContain("crime has occurred");
  });
});
