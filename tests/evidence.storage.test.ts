import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// storeOriginalEvidence reads settings.evidenceStorageDir at import time, so we
// point THREATLENS_STORAGE_DIR at a throwaway temp directory (relative to
// process.cwd()) before importing the module under test.
let tmpRelativeDir: string;
let storeOriginalEvidence: typeof import("@/lib/threatlens/evidence/service").storeOriginalEvidence;
let EvidenceValidationError: typeof import("@/lib/threatlens/evidence/service").EvidenceValidationError;
let generateEvidenceId: typeof import("@/lib/threatlens/evidence/service").generateEvidenceId;

beforeAll(async () => {
  const tmpAbsoluteDir = mkdtempSync(path.join(os.tmpdir(), "threatlens-test-"));
  tmpRelativeDir = path.relative(process.cwd(), tmpAbsoluteDir);
  process.env.THREATLENS_STORAGE_DIR = tmpRelativeDir;

  const mod = await import("@/lib/threatlens/evidence/service");
  storeOriginalEvidence = mod.storeOriginalEvidence;
  EvidenceValidationError = mod.EvidenceValidationError;
  generateEvidenceId = mod.generateEvidenceId;
});

afterAll(() => {
  rmSync(path.join(process.cwd(), tmpRelativeDir), { recursive: true, force: true });
  delete process.env.THREATLENS_STORAGE_DIR;
});

describe("storeOriginalEvidence", () => {
  it("stores original bytes under a UUID-derived path, not the user filename", async () => {
    const id = generateEvidenceId();
    const relPath = await storeOriginalEvidence({ evidenceId: id, extension: ".png", buffer: Buffer.from("fake-image-bytes") });
    expect(relPath).toContain(id);
    expect(relPath.endsWith("original.png")).toBe(true);
  });

  it("rejects a non-UUID evidence id (defense against path traversal)", async () => {
    await expect(
      storeOriginalEvidence({ evidenceId: "../../etc/passwd", extension: ".png", buffer: Buffer.from("x") })
    ).rejects.toThrow(EvidenceValidationError);
  });

  it("refuses to overwrite existing evidence (immutability)", async () => {
    const id = generateEvidenceId();
    await storeOriginalEvidence({ evidenceId: id, extension: ".png", buffer: Buffer.from("first") });
    await expect(
      storeOriginalEvidence({ evidenceId: id, extension: ".png", buffer: Buffer.from("second") })
    ).rejects.toThrow(EvidenceValidationError);
  });
});
