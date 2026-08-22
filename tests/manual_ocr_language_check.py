"""
Manual OCR language verification script (Section 15).

This is NOT an automated pytest test - it does not start with
"test_" so pytest will not collect it. Run it directly:

    python tests/manual_ocr_language_check.py <path_to_image>

Purpose: honestly test (not assume) how EasyOCR performs on:
    1. English
    2. Devanagari Hindi
    3. Romanized Hindi / Hinglish

BEFORE creating any documentation claim about language support.

How to create test images:
    1. Open Notepad, WhatsApp Web, or any text app.
    2. Type each of these three sentences separately:
         English:          I know where you live.
         Devanagari Hindi: paste: Mujhe pata hai tum kahan rehte ho.
         Hinglish:         Mujhe pata hai tum kahan rehte ho.
    3. Take a screenshot of each (PNG format).
    4. Save them in ocr_manual_test_images/ (already gitignored).
    5. Run this script against each image and record what actually
       happens - do not assume, read the output.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nyayaai.ocr import DEFAULT_LANGUAGES, run_ocr  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python tests/manual_ocr_language_check.py <path_to_image>")
        sys.exit(1)

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(f"File not found: {image_path}")
        sys.exit(1)

    print(f"Running OCR on: {image_path}")
    print(f"Languages: {DEFAULT_LANGUAGES}")
    print("(First run downloads OCR models - this may take a few minutes.)\n")

    result = run_ocr(image_path, languages=list(DEFAULT_LANGUAGES))

    print("SUCCESS:", result.success)
    if not result.success:
        print("ERROR:", result.error_message)
        return

    print("DOCUMENT CONFIDENCE:", result.document_confidence)
    print("\nRAW EXTRACTED TEXT:")
    print(result.raw_text if result.raw_text else "(no text detected)")
    print("\nPER-REGION DETAIL:")
    for region in result.regions:
        print(f"  [{region.confidence:.2f}] {region.text}")


if __name__ == "__main__":
    main()
