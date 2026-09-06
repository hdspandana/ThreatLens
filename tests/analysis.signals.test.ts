import { describe, expect, it } from "vitest";
import { detectSignals } from "@/lib/threatlens/analysis/signals";

describe("detectSignals", () => {
  it("returns no signals for benign text", () => {
    const signals = detectSignals("Hey, are we still on for coffee tomorrow at 10am?");
    expect(signals).toHaveLength(0);
  });

  it("detects a direct threat and captures the exact evidence span", () => {
    const text = "You should know that I am going to kill you if you tell anyone.";
    const signals = detectSignals(text);
    const threat = signals.find((s) => s.category === "direct_threat");
    expect(threat).toBeDefined();
    expect(text.slice(threat!.startOffset, threat!.endOffset)).toBe(threat!.evidenceSpan);
    expect(threat!.detectionSource).toBe("rule_based");
  });

  it("detects blackmail/extortion patterns", () => {
    const text = "Pay me $500 or I will post those photos unless you send the money today.";
    const signals = detectSignals(text);
    const categories = signals.map((s) => s.category);
    expect(categories).toContain("extortion");
  });

  it("detects stalking indicators", () => {
    const signals = detectSignals("I have been watching you all week and I drove by your house last night.");
    const categories = signals.map((s) => s.category);
    expect(categories).toContain("stalking");
  });

  it("detects abusive language", () => {
    const signals = detectSignals("You're worthless and nobody likes you.");
    const categories = signals.map((s) => s.category);
    expect(categories).toContain("hate_abusive_language");
  });

  it("returns signals sorted by their position in the text", () => {
    const text = "Kill yourself. Also, I know where you live.";
    const signals = detectSignals(text);
    const offsets = signals.map((s) => s.startOffset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("handles empty text without throwing", () => {
    expect(detectSignals("")).toEqual([]);
  });

  it("every signal has a confidence within [0, 1]", () => {
    const text = "I will kill you. Send me bitcoin or I will leak your photos unless you pay.";
    const signals = detectSignals(text);
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });
});
