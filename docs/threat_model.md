# ThreatLens Application Threat Model (Phase 1)

ThreatLens processes hostile input by design: the evidence a victim uploads
was written by an adversary. This document lists the assets, trust
boundaries, threats considered, controls in place after Phase 1, and gaps
scheduled for later phases. It is a living document — update it in every
phase that touches an input surface.

## Assets
- **Original evidence bytes** (immutable; `storage/evidence/<uuid>/original.<ext>`).
- **Verified text and analyses** (sensitive personal content in Postgres).
- **LLM API key** (server-side env only).
- **Integrity of findings** (an attacker must not be able to make the system emit a fabricated or suppressed finding).
- **Audit trail** (append-only).

## Trust boundaries
```
Browser ──multipart──► API route ──bytes──► evidence/service (validate, hash, store)
                                   └──bytes──► ocr/service (local tesseract, no network)
Verified text (human) ──► text/processing ──► rules ──► risk ──► retrieval (local)
                                   └── UNTRUSTED DATA BLOCK ──► LLM (external, optional) ──► output guard
```
Everything derived from the upload — bytes, OCR text, verified text — is
treated as untrusted at every hop.

## Threats and controls

| # | Threat | Control (Phase 1) | Test |
|---|---|---|---|
| 1 | Path traversal via filename | Storage path derived from server UUID only; UUID re-validated; resolved path must stay under root | `evidence.storage.test.ts` |
| 2 | Disguised / polyglot uploads (MIME spoofing) | Extension allow-list AND magic-byte sniff; WEBP requires RIFF+WEBP marker; declared MIME recorded but not trusted | `evidence.service.test.ts` |
| 3 | Oversized upload / memory exhaustion | `Content-Length` pre-check (413) before body parse; post-parse size check retained for chunked bodies | `security.test.ts` |
| 4 | Evidence overwrite / tampering after intake | Write-once (`wx`); SHA-256 recorded; hash surfaced in report as integrity-only | `evidence.storage.test.ts` |
| 5 | Malformed / malicious image crashing the process | tesseract worker `errorHandler` set; failures returned as structured `succeeded:false` | `ocr.service.test.ts` |
| 6 | Corrupted or tampered OCR model | Manifest SHA-256 verification before worker start; UTF-8-mangle heuristic; explicit `OcrLanguageDataError`; `cacheMethod:"none"` so the library can never delete bundled data | `ocr.integrity.test.ts` |
| 7 | IDOR / id probing / uuid-cast errors | Strict UUID regex on all `:id` params → 404 | `security.test.ts` |
| 8 | SQL injection | Drizzle parameterised queries only; no string-built SQL with user input | code review |
| 9 | Prompt injection via evidence text | Evidence wrapped in delimited UNTRUSTED block with delimiter/template-token neutralisation; system prompt states evidence is data; injection indicators recorded and passed as a flag; output guard rejects prompt leaks, secrets, URLs, HTML, role-shift language → deterministic fallback | `llm.prompt_injection.test.ts`, `security.test.ts` |
| 10 | LLM data exfiltration | Only structured findings + ≤2000-char excerpt sent; no file bytes, no paths, no ids; guard blocks URLs in output (exfil beacons) | `llm.prompt_injection.test.ts` |
| 11 | XSS through extracted text | React auto-escapes; report is served as `text/markdown` attachment with `nosniff`; inline values escaped; fences sized above any backtick run | `security.test.ts` |
| 12 | Markdown/report injection | `fencedBlock`, `escapeInlineMarkdown` | `security.test.ts` |
| 13 | Log injection / sensitive logging | `safeLog` strips CR/LF/control chars, drops content-bearing and secret keys, caps length; correlation ids instead of content | `security.test.ts` |
| 14 | Provider error body leakage | LLM HTTP error bodies are no longer echoed | `llm.prompt_injection.test.ts` |
| 15 | Silent model/rule drift | Every analysis stores classifier/rule/risk/KB/prompt/OCR versions and input hash | `pipeline.integration.test.ts` |
| 16 | SSRF | LLM base URL comes from server config only; no user-supplied URLs are fetched anywhere | code review |

## Known gaps (scheduled)
- **Authentication / case-level authorization** — none; single local user assumed. Phase 8.
- **Encryption at rest** for verified text / analyses; **secure deletion**; **retention policy**. Phase 8.
- **Rate limiting** on upload and analyze. Phase 8.
- **Zip bombs / archives** — not applicable yet (images only); revisit when exported-conversation formats are accepted.
- **Decompression bombs inside images** — tesseract's WASM has its own memory ceiling; the 10 MB byte cap bounds the input but not the decoded pixel count. Consider a dimension check in Phase 8.
- **Adversarial evasion of detection rules** — Phase 6.
- **Threat-intel outbound lookups** introduce a new SSRF/privacy surface — design the adapter with an allow-list in Phase 7.
