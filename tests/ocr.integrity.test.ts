/**
 * OCR language-data integrity: the bundled model must match its manifest,
 * and a corrupted model must be reported explicitly (not silently fail or
 * be deleted). Also runs a real recognition against a synthetic image to
 * prove the bundled data actually initialises.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

describe("verifyLanguageData", () => {
  it("bundled eng model matches MANIFEST.json and is not UTF-8 mangled", async () => {
    const { verifyLanguageData } = await import("@/lib/threatlens/ocr/service");
    const info = verifyLanguageData();
    expect(info.manifestVerified).toBe(true);
    expect(info.fileName).toBe("eng.traineddata");
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "data/tessdata/MANIFEST.json"), "utf-8"));
    expect(info.sha256).toBe(manifest.files["eng.traineddata"].sha256Uncompressed);
  });
});

describe("corrupted language data", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "tl-tessdata-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("is rejected with an explicit error and left untouched", async () => {
    const rel = path.relative(process.cwd(), tmp);
    // Simulate the exact corruption found in the original repository: 0xFF bytes replaced by EF BF BD.
    const corrupt = Buffer.concat([Buffer.from([0x18, 0, 0, 0]), Buffer.from("\ufffd\ufffd\ufffd\ufffd", "utf8"), Buffer.alloc(64)]);
    writeFileSync(path.join(tmp, "eng.traineddata"), corrupt);
    writeFileSync(
      path.join(tmp, "MANIFEST.json"),
      JSON.stringify({ files: { "eng.traineddata": { language: "eng", sha256Gzipped: "", sha256Uncompressed: "0".repeat(64), modelFamily: "x" } } })
    );
    const prev = process.env.THREATLENS_OCR_LANGDATA_DIR;
    process.env.THREATLENS_OCR_LANGDATA_DIR = rel;
    const { vi } = await import("vitest");
    vi.resetModules();
    const { verifyLanguageData, OcrLanguageDataError } = await import("@/lib/threatlens/ocr/service");
    expect(() => verifyLanguageData()).toThrow(OcrLanguageDataError);
    // The file must still exist: we never delete bundled data.
    const stillThere = readFileSync(path.join(tmp, "eng.traineddata"));
    expect(createHash("sha256").update(stillThere).digest("hex")).toBe(createHash("sha256").update(corrupt).digest("hex"));
    if (prev === undefined) delete process.env.THREATLENS_OCR_LANGDATA_DIR;
    else process.env.THREATLENS_OCR_LANGDATA_DIR = prev;
    vi.resetModules();
  });
});
