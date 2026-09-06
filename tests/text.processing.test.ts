import { describe, expect, it } from "vitest";
import { processText } from "@/lib/threatlens/text/processing";

describe("processText", () => {
  it("normalizes curly quotes and dashes without changing meaning", () => {
    const result = processText("I\u2019m going to\u2014stop this.");
    expect(result.normalizedText).toContain("I'm going to-stop this.");
    expect(result.changesApplied).toContain("ocr_artifact_cleanup");
  });

  it("collapses excess whitespace", () => {
    const result = processText("Hello    world\t\tagain");
    expect(result.normalizedText).toBe("Hello world again");
  });

  it("removes exact consecutive duplicate lines (common OCR artifact)", () => {
    const result = processText("stop texting me\nstop texting me\nplease");
    expect(result.normalizedText.split("\n")).toEqual(["stop texting me", "please"]);
    expect(result.changesApplied).toContain("duplicate_line_removal");
  });

  it("does not collapse non-consecutive repeats (preserves meaning)", () => {
    const result = processText("stop\nok\nstop");
    expect(result.normalizedText.split("\n")).toEqual(["stop", "ok", "stop"]);
  });

  it("segments messages on blank lines", () => {
    const result = processText("First message\n\nSecond message");
    expect(result.segments).toEqual(["First message", "Second message"]);
  });

  it("preserves original meaning: no aggressive rewriting of words", () => {
    const input = "You will regret this decision.";
    const result = processText(input);
    expect(result.normalizedText).toBe(input);
  });

  it("handles empty input gracefully", () => {
    const result = processText("");
    expect(result.normalizedText).toBe("");
    expect(result.segments).toEqual([]);
  });
});
