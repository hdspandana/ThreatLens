# OCR Manual Language Test ? Initial Findings (Phase 3)

Date: 2026-08-23
Method: Section 15 manual testing, tests/manual_ocr_language_check.py
Sample size: n=1 per language (NOT a statistically meaningful evaluation -
see eval/ for the real evaluation dataset, built separately).

## Results

### English
Input:  "I know where you live."
Output: "- / know / where / you / Live ."
Document confidence: 0.86
Notes: The word "I" was misread as a dash character and effectively lost.
Remaining words correct. Meaning still recoverable by a human reader.

### Devanagari Hindi
Input:  "???? ??? ?? ??? ???? ???? ???"
Output: "???? ??? ?? ??? ???? ???? ??l"
Document confidence: 0.40 (below LOW_CONFIDENCE_THRESHOLD = 0.5)
Notes: Text recognized correctly at the word level; only the trailing
danda (?) was misread as the letter "l". Despite near-perfect
transcription, confidence was low enough to trigger mandatory human
verification in the UI. This suggests document confidence does not
reliably correlate with actual correctness for Devanagari script -
an open question for further evaluation (see eval/).

### "Hinglish" (Romanized Hindi, Latin script)
Input:  "Mujhe pata hai tum kahan rehte ho."
Output: "Mujhe pata / hai / tum / kahan / rehte / ho _"
Document confidence: 0.80
Notes: Transcribed correctly at the character level. IMPORTANT: this
is NOT evidence of Hinglish language understanding - EasyOCR's English
model is simply reading standard Latin characters, the same as it
would for any English text. No semantic Hinglish support is claimed
or implied by this result.

## Conclusions for documentation

DO claim:
- English text extraction works, with occasional single-character
  loss on short/isolated words.
- Devanagari Hindi text extraction was accurate in this initial
  sample.
- Romanized Hindi (Hinglish) transcribes accurately at the character
  level because it is read as Latin script - this is NOT semantic
  Hinglish understanding.
- Low OCR confidence correctly triggers mandatory human verification,
  regardless of whether the underlying transcription happens to be
  correct.

DO NOT claim:
- Broad "Hindi and Hinglish support" as a headline feature.
- Any numeric accuracy/WER/CER figure (n=1 is not sufficient - see
  eval/ for the real evaluation methodology).
- That OCR confidence is a reliable proxy for correctness.

## Open questions for eval/ phase
- Is 0.40 confidence typical for CORRECT Devanagari OCR, or specific
  to this sample? If typical, LOW_CONFIDENCE_THRESHOLD may cause
  frequent unnecessary review flags for Hindi text - this is a
  usability tradeoff, not a correctness bug, and should be measured
  with a larger sample before adjusting.
