/**
 * Text processing layer.
 *
 * Takes human-VERIFIED text (never raw OCR output directly) and produces a
 * normalized form used by downstream analysis. Normalization here is
 * intentionally conservative: it fixes formatting artifacts without
 * altering the substantive meaning of the message, since this text may
 * become part of an incident record.
 */
import type { ProcessedText } from "../schemas/models";

/** Common OCR ligature / artifact substitutions that don't change meaning. */
const OCR_ARTIFACT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u2018|\u2019/g, "'"], // curly single quotes -> straight
  [/\u201c|\u201d/g, '"'], // curly double quotes -> straight
  [/\u2013|\u2014/g, "-"], // en/em dash -> hyphen
  [/\u00a0/g, " "], // non-breaking space -> normal space
  [/\ufb01/g, "fi"],
  [/\ufb02/g, "fl"],
];

export function processText(rawVerifiedText: string): ProcessedText {
  const changesApplied: string[] = [];
  let text = rawVerifiedText.normalize("NFC");
  if (text !== rawVerifiedText) changesApplied.push("unicode_nfc_normalization");

  const beforeArtifacts = text;
  for (const [pattern, replacement] of OCR_ARTIFACT_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  if (text !== beforeArtifacts) changesApplied.push("ocr_artifact_cleanup");

  const beforeWhitespace = text;
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
  if (text !== beforeWhitespace) changesApplied.push("whitespace_normalization");

  const lines = text.split("\n").filter((l) => l.length > 0);
  const beforeDedupe = lines.length;
  const dedupedLines: string[] = [];
  for (const line of lines) {
    const prev = dedupedLines[dedupedLines.length - 1];
    // Collapse only EXACT consecutive duplicate lines (common OCR repeat artifact),
    // never near-duplicates, to avoid silently discarding distinct messages.
    if (prev !== line) dedupedLines.push(line);
  }
  if (dedupedLines.length !== beforeDedupe) changesApplied.push("duplicate_line_removal");

  const normalizedText = dedupedLines.join("\n");

  // Message segmentation: split on blank lines or common chat timestamp
  // patterns, falling back to sentence-ish splitting for a single block.
  const segments = segmentMessages(normalizedText);

  return { normalizedText, segments, changesApplied };
}

function segmentMessages(text: string): string[] {
  if (!text) return [];
  const byBlankLine = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;

  const byNewline = text.split("\n").map((s) => s.trim()).filter(Boolean);
  if (byNewline.length > 1) return byNewline;

  // Single block of text: keep as one segment. We deliberately do NOT
  // split on sentence punctuation, since threats/harassment often lack
  // standard punctuation and splitting could break evidence-span offsets.
  return text.trim().length > 0 ? [text.trim()] : [];
}
