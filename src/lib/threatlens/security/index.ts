/**
 * Security primitives shared by API routes and pipeline stages.
 *
 * Threat-model context (see docs/threat_model.md): uploaded evidence is
 * HOSTILE input. It may contain prompt-injection payloads, log-injection
 * sequences, markdown/HTML that breaks report rendering, and identifiers
 * crafted to probe the database. Everything here is dependency-free.
 */
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Strict RFC-4122 UUID check. Non-UUID route params never reach Postgres (avoids uuid-cast errors / probing). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function newCorrelationId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Safe logging
// ---------------------------------------------------------------------------

/** Keys that must never appear in a log line, even if a caller passes them by mistake. */
const FORBIDDEN_LOG_KEYS = new Set([
  "text",
  "rawText",
  "verifiedText",
  "normalizedText",
  "content",
  "message",
  "summary",
  "apiKey",
  "authorization",
  "storedPath",
  "originalFilename",
  "buffer",
]);

const MAX_LOG_VALUE_LENGTH = 200;

/** Removes CR/LF and other control characters so a hostile value cannot forge additional log lines. */
export function sanitizeLogValue(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  // eslint-disable-next-line no-control-regex
  const cleaned = str.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
  return cleaned.length > MAX_LOG_VALUE_LENGTH ? `${cleaned.slice(0, MAX_LOG_VALUE_LENGTH)}…` : cleaned;
}

export type LogLevel = "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel | "silent", number> = { info: 0, warn: 1, error: 2, silent: 3 };

/** Minimum level emitted; THREATLENS_LOG_LEVEL=silent disables logging (used by the test runner). */
function minLevel(): LogLevel | "silent" {
  const raw = (process.env.THREATLENS_LOG_LEVEL ?? "info").toLowerCase();
  return raw in LEVEL_RANK ? (raw as LogLevel | "silent") : "info";
}

/**
 * Structured, content-free logger. Only whitelisted scalar fields are
 * emitted; anything resembling evidence content or secrets is dropped.
 */
export function safeLog(
  level: LogLevel,
  event: string,
  fields: Record<string, string | number | boolean | null | undefined> = {}
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel()]) return;
  const safeFields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_LOG_KEYS.has(key)) continue;
    if (value === undefined) continue;
    safeFields[sanitizeLogValue(key)] =
      typeof value === "number" || typeof value === "boolean" || value === null ? value : sanitizeLogValue(value);
  }
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event: sanitizeLogValue(event), ...safeFields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Extracts a loggable, sanitized error summary (class name + trimmed message, no stack, no payload). */
export function errorSummary(err: unknown): string {
  if (err instanceof Error) return sanitizeLogValue(`${err.name}: ${err.message}`);
  return sanitizeLogValue(String(err));
}

// ---------------------------------------------------------------------------
// Untrusted content / prompt-injection boundary
// ---------------------------------------------------------------------------

/**
 * Patterns that look like instructions aimed at an AI system rather than at
 * a human recipient. Their presence in evidence is recorded as a FOUND fact
 * and used to (a) warn reviewers and (b) tighten the LLM output guard.
 * These are indicators, not proof of malicious intent.
 */
const INJECTION_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: "ignore_previous_instructions", regex: /\b(ignore|disregard|forget)\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?)\b/i },
  { id: "role_override", regex: /\b(you are now|act as|pretend (to be|you are)|from now on you)\b/i },
  { id: "system_prompt_probe", regex: /\b(reveal|print|show|output|repeat)\b[^.\n]{0,40}\b(system prompt|instructions|hidden prompt|configuration|api key|secret)\b/i },
  { id: "role_marker", regex: /^(\s*)(system|assistant|user)\s*:/im },
  { id: "chat_template_token", regex: /<\|(im_start|im_end|system|user|assistant|endoftext)\|>|\[INST\]|\[\/INST\]|<<SYS>>/i },
  { id: "developer_mode", regex: /\b(developer mode|jailbreak|DAN mode)\b/i },
  { id: "tool_call_injection", regex: /\b(call|invoke|execute|run)\s+(the\s+)?(tool|function|command)\b/i },
];

/** Returns the ids of injection-like patterns found in text (deduplicated, deterministic order). */
export function detectInjectionIndicators(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.regex.test(text)) found.push(p.id);
  }
  return found;
}

export const UNTRUSTED_OPEN = "<<<BEGIN_UNTRUSTED_EVIDENCE_TEXT>>>";
export const UNTRUSTED_CLOSE = "<<<END_UNTRUSTED_EVIDENCE_TEXT>>>";

/**
 * Wraps evidence text in an explicit, unforgeable-in-practice trust
 * boundary for inclusion in an LLM prompt. Any occurrence of our own
 * delimiters inside the text is neutralised so the content cannot close the
 * block early, and chat-template tokens are broken up.
 */
export function wrapUntrustedText(text: string, maxLength = 2000): string {
  let body = text.slice(0, maxLength);
  body = body.split(UNTRUSTED_OPEN).join("<<<[delimiter-in-evidence]>>>");
  body = body.split(UNTRUSTED_CLOSE).join("<<<[delimiter-in-evidence]>>>");
  body = body.replace(/<\|/g, "< |").replace(/\|>/g, "| >");
  return `${UNTRUSTED_OPEN}\n${body}\n${UNTRUSTED_CLOSE}`;
}

export interface OutputGuardResult {
  passed: boolean;
  findings: string[];
}

/**
 * Post-generation screen for the LLM explanation. Flags outputs that look
 * like the model followed instructions embedded in evidence (leaked prompt,
 * role switching, secrets, markup/links that could be phishing vectors).
 */
export function guardLlmOutput(output: string, context: { systemPromptFragments: string[] }): OutputGuardResult {
  const findings: string[] = [];
  if (!output || output.trim().length === 0) {
    findings.push("empty_output");
    return { passed: false, findings };
  }
  for (const fragment of context.systemPromptFragments) {
    if (fragment.length >= 40 && output.includes(fragment)) {
      findings.push("system_prompt_leak");
      break;
    }
  }
  if (/\b(sk-[a-z0-9]{8,}|api[_ -]?key\s*[:=])/i.test(output)) findings.push("possible_secret_in_output");
  if (/https?:\/\//i.test(output)) findings.push("url_in_output");
  if (/<\s*(script|iframe|img|a)\b/i.test(output)) findings.push("html_markup_in_output");
  if (/\b(as an ai|i am now|developer mode|jailbreak)\b/i.test(output)) findings.push("role_shift_language");
  if (output.length > 4000) findings.push("output_too_long");
  return { passed: findings.length === 0, findings };
}

// ---------------------------------------------------------------------------
// Markdown safety for generated reports
// ---------------------------------------------------------------------------

/**
 * Evidence text is embedded in fenced code blocks in reports. A payload
 * containing ``` could close the fence and inject arbitrary markdown/HTML.
 * We use a longer fence than any run of backticks present in the content.
 */
export function fencedBlock(text: string): string {
  const longestRun = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence}\n${text}\n${fence}`;
}

/** Neutralises markdown control characters in a single inline value (titles, filenames, spans). */
export function escapeInlineMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-!|<>]/g, (c) => `\\${c}`).replace(/\r?\n/g, " ");
}
