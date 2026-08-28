import { describe, expect, it } from "vitest";
import {
  EvidenceValidationError,
  computeSha256,
  generateEvidenceId,
  sanitizeDisplayFilename,
  sniffMimeType,
  validateUpload,
} from "@/lib/threatlens/evidence/service";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe("sniffMimeType", () => {
  it("detects PNG by magic bytes", () => {
    expect(sniffMimeType(PNG_HEADER)).toBe("image/png");
  });

  it("detects JPEG by magic bytes", () => {
    expect(sniffMimeType(JPEG_HEADER)).toBe("image/jpeg");
  });

  it("returns null for unrecognized content", () => {
    expect(sniffMimeType(Buffer.from("not an image, just text"))).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a valid PNG", () => {
    const result = validateUpload({ buffer: PNG_HEADER, filename: "evidence.png", declaredMimeType: "image/png" });
    expect(result.detectedMimeType).toBe("image/png");
    expect(result.extension).toBe(".png");
  });

  it("rejects an empty file", () => {
    expect(() =>
      validateUpload({ buffer: Buffer.alloc(0), filename: "a.png", declaredMimeType: "image/png" })
    ).toThrow(EvidenceValidationError);
  });

  it("rejects a disallowed extension", () => {
    expect(() => validateUpload({ buffer: PNG_HEADER, filename: "evidence.exe", declaredMimeType: "image/png" })).toThrow(
      EvidenceValidationError
    );
  });

  it("rejects a file whose content does not match a known image signature (disguised file)", () => {
    const fakeBuffer = Buffer.from("MZ this is actually an executable pretending to be a png");
    expect(() => validateUpload({ buffer: fakeBuffer, filename: "evidence.png", declaredMimeType: "image/png" })).toThrow(
      EvidenceValidationError
    );
  });

  it("rejects files exceeding the configured max size", () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(11 * 1024 * 1024)]);
    expect(() => validateUpload({ buffer: big, filename: "evidence.png", declaredMimeType: "image/png" })).toThrow(
      EvidenceValidationError
    );
  });
});

describe("sanitizeDisplayFilename", () => {
  it("strips path traversal components", () => {
    expect(sanitizeDisplayFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeDisplayFilename("../../etc/passwd")).not.toContain("/");
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeDisplayFilename("evi<>dence?.png")).toMatch(/^[a-zA-Z0-9._ -]+$/);
  });

  it("falls back to a default name when nothing usable remains", () => {
    expect(sanitizeDisplayFilename("////")).toBe("unnamed_upload");
  });
});

describe("computeSha256", () => {
  it("is deterministic for identical content", () => {
    const a = computeSha256(Buffer.from("hello world"));
    const b = computeSha256(Buffer.from("hello world"));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs for different content", () => {
    const a = computeSha256(Buffer.from("hello world"));
    const b = computeSha256(Buffer.from("hello world!"));
    expect(a).not.toBe(b);
  });
});

describe("generateEvidenceId", () => {
  it("produces unique v4-style UUIDs", () => {
    const id1 = generateEvidenceId();
    const id2 = generateEvidenceId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
