/**
 * Text similarity metrics (Character/Word Error Rate) based on Levenshtein
 * edit distance. Used for OCR evaluation when a reference transcription is
 * available. See docs/evaluation.md for why we do not currently run this
 * against real scanned images (no licensed labeled dataset in this repo).
 */

function levenshtein<T>(a: T[], b: T[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[a.length][b.length];
}

/** Character Error Rate: edit distance over characters, normalized by reference length. */
export function characterErrorRate(hypothesis: string, reference: string): number {
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  return levenshtein(hypothesis.split(""), reference.split("")) / reference.length;
}

/** Word Error Rate: edit distance over whitespace-tokenized words, normalized by reference word count. */
export function wordErrorRate(hypothesis: string, reference: string): number {
  const refWords = reference.trim().split(/\s+/).filter(Boolean);
  const hypWords = hypothesis.trim().split(/\s+/).filter(Boolean);
  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 1;
  return levenshtein(hypWords, refWords) / refWords.length;
}
