"""
Manual OCR language verification script (Section 15).

This is NOT an automated pytest test - it does not start with
"test_" so pytest will not collect it. Run it directly:

    python tests/manual_ocr_language_check.py <path_to_image> [--preprocess]

Use --preprocess to test the optional grayscale + contrast
enhancement step (see nyayaai/ocr.py: preprocess_image_for_ocr).
Run the SAME image with and without --preprocess and compare the
output honestly before concluding whether preprocessing helps.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nyayaai.ocr import DEFAULT_LANGUAGES, run_ocr  # noqa: E402


def main() -> None:
    args = sys.argv[1:]
    apply_preprocessing = "--preprocess" in args
    positional = [a for a in args if a != "--preprocess"]

    if len(positional) != 1:
        print("Usage: python tests/manual_ocr_language_check.py <path_to_image> [--preprocess]")
        sys.exit(1)

    image_path = Path(positional[0])
    if not image_path.exists():
        print(f"File not found: {image_path}")
        sys.exit(1)

    print(f"Running OCR on: {image_path}")
    print(f"Languages: {DEFAULT_LANGUAGES}")
    print(f"Preprocessing enabled: {apply_preprocessing}")
    print("(First run downloads OCR models - this may take a few minutes.)\n")

    result = run_ocr(
        image_path,
        languages=list(DEFAULT_LANGUAGES),
        apply_preprocessing=apply_preprocessing,
    )

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
