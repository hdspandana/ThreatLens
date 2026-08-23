"""
NyayaAI - OCR.

Implements Section 14 of the project specification using EasyOCR.

IMPORTANT HONESTY NOTES (do not remove these when editing this file):

1. First use of a given language combination triggers EasyOCR to
   download pretrained model weights over the network. This is a
   ONE-TIME setup exception to the "no network calls in the core
   pipeline" rule - after models are cached locally (~/.EasyOCR/),
   no further network access occurs during case processing.

2. Document-level confidence is a SIMPLE ARITHMETIC MEAN of
   per-detected-region confidence scores. It is not length-weighted,
   not area-weighted, and is not a calibrated probability. If zero
   text regions are detected, confidence is None (distinct from a
   confidence of 0.0).

3. This module NEVER sets human_verified=True or populates
   verified_text. Those fields are only ever set by a human operator
   via the verification step (a later phase). Raw OCR output is
   always unverified by construction.

4. Whether Hindi/Hinglish OCR actually performs adequately has NOT
   been broadly claimed here - it was tested manually with n=1 per
   language (see docs/ocr_language_findings_phase3.md). Findings:
   English and Devanagari Hindi text extracted correctly in that
   sample; "Hinglish" is Latin-script text read by the English model,
   not genuine Hinglish language understanding.

5. Optional preprocessing (grayscale + contrast enhancement) was
   added after observing a single-character detection failure
   ("I" dropped) during manual testing. It is OFF BY DEFAULT and its
   effectiveness must be verified empirically by direct A/B
   comparison (see tests/manual_ocr_language_check.py --preprocess),
   not assumed to be an improvement.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from PIL import Image, ImageEnhance

import easyocr

from nyayaai.schema import OCRResult

# EasyOCR language codes. "en" = English, "hi" = Hindi (Devanagari
# script). EasyOCR has no dedicated Romanized-Hindi/Hinglish model -
# Hinglish text is read using the "en" model since it uses Latin
# characters, with no semantic Hindi understanding involved.
DEFAULT_LANGUAGES: Tuple[str, ...] = ("en", "hi")

# Heuristic starting threshold for flagging low-confidence OCR results
# in the UI. Not derived from a measured requirement. Manual testing
# (n=1) showed a correctly-transcribed Devanagari sample scoring
# BELOW this threshold, meaning this gate may over-flag correct
# Hindi text for review - an open question for the full evaluation
# phase (see docs/ocr_language_findings_phase3.md).
LOW_CONFIDENCE_THRESHOLD = 0.5

# Heuristic default contrast multiplier for optional preprocessing.
# Not scientifically tuned - a reasonable starting point only.
DEFAULT_CONTRAST_FACTOR = 1.5

# Module-level cache of initialized EasyOCR readers, keyed by the
# language tuple. Reader initialization is expensive (loads models
# into memory), so this cache prevents re-initialization on every
# call within the same process.
_READER_CACHE: Dict[Tuple[str, ...], "easyocr.Reader"] = {}


@dataclass
class DetectedTextRegion:
    """A single detected text region from EasyOCR, before aggregation."""

    text: str
    confidence: float
    bbox: Any  # EasyOCR's bounding box format: list of 4 (x, y) points


@dataclass
class OCRExtractionResult:
    """Full internal OCR extraction result.

    This is a richer, internal-only type - NOT part of the persisted
    IncidentRecord schema. Use to_schema_ocr_result() to convert the
    relevant subset into nyayaai.schema.OCRResult for storage.
    """

    success: bool
    raw_text: str
    document_confidence: Optional[float]
    regions: List[DetectedTextRegion] = field(default_factory=list)
    error_message: Optional[str] = None
    languages_used: List[str] = field(default_factory=list)
    preprocessing_applied: bool = False


def get_reader(languages: Tuple[str, ...]) -> "easyocr.Reader":
    """Return a cached EasyOCR Reader for the given language tuple.

    Initializes lazily on first call for a given language combination.
    Always uses gpu=False, since NyayaAI is positioned as a local-first
    laptop tool and must not assume CUDA availability.
    """
    if languages not in _READER_CACHE:
        _READER_CACHE[languages] = easyocr.Reader(list(languages), gpu=False)
    return _READER_CACHE[languages]


def preprocess_image_for_ocr(
    image_path: Path, contrast_factor: float = DEFAULT_CONTRAST_FACTOR
) -> Image.Image:
    """Apply basic preprocessing to a source image to attempt to
    improve OCR detection quality.

    Preprocessing is deliberately simple and heuristic:
        1. Convert to grayscale.
        2. Increase contrast by a fixed multiplicative factor.

    This was added after observing a single-character detection
    failure during manual testing (Section 15) - it is a heuristic
    starting point, NOT a scientifically tuned pipeline. Whether this
    actually improves results must be verified empirically by
    comparing OCR output with and without this step - never assumed.

    Args:
        image_path: Path to the source image file.
        contrast_factor: Multiplier for contrast enhancement. 1.0
            leaves contrast unchanged; >1.0 increases it.

    Returns:
        A new, preprocessed PIL Image. The original file on disk is
        never modified (Section 13: evidence must remain unmodified).
    """
    image = Image.open(image_path).convert("L")
    enhancer = ImageEnhance.Contrast(image)
    return enhancer.enhance(contrast_factor)


def compute_document_confidence(confidences: List[float]) -> Optional[float]:
    """Compute document-level OCR confidence as a simple arithmetic mean.

    This is deliberately the simplest possible aggregation: the mean
    of all per-region confidence scores. It is NOT weighted by text
    length or region area, and it is NOT a calibrated probability -
    it is a heuristic summary number intended to flag likely-poor
    extractions for human review.

    Returns:
        The mean confidence, or None if the input list is empty
        (i.e. no text was detected at all - distinct from a detected
        region with confidence 0.0).
    """
    if not confidences:
        return None
    return sum(confidences) / len(confidences)


def extract_raw_text(detections: List[Tuple[Any, str, float]]) -> str:
    """Join detected text regions into a single raw text block.

    Regions are joined in the order EasyOCR returns them, separated
    by newlines. This order approximates reading order for simple,
    single-column layouts (e.g. a chat screenshot) but is NOT
    guaranteed to be correct reading order for complex or multi-column
    layouts. This is a known limitation, not a bug.
    """
    return "\n".join(text for (_bbox, text, _confidence) in detections)


def is_low_confidence(confidence: Optional[float]) -> bool:
    """Return True if this OCR result should be flagged for extra
    scrutiny during human verification.

    A None confidence (no text detected at all) is treated as
    low-confidence, since it equally requires human attention.
    """
    if confidence is None:
        return True
    return confidence < LOW_CONFIDENCE_THRESHOLD


def run_ocr(
    image_path: Path,
    languages: Optional[List[str]] = None,
    apply_preprocessing: bool = False,
    contrast_factor: float = DEFAULT_CONTRAST_FACTOR,
) -> OCRExtractionResult:
    """Run OCR on a single image file and return the extraction result.

    Never raises on OCR-level failures (e.g. corrupt image, unreadable
    file) - instead returns an OCRExtractionResult with success=False
    and error_message set, so the caller can fall back to manual text
    entry (Section 34).

    Args:
        image_path: Path to the image file to run OCR on.
        languages: EasyOCR language codes to use. Defaults to
            DEFAULT_LANGUAGES ("en", "hi").
        apply_preprocessing: If True, applies grayscale + contrast
            enhancement before running OCR (see
            preprocess_image_for_ocr). Default False - preprocessing
            is opt-in, not automatic, until proven beneficial by
            direct comparison.
        contrast_factor: Contrast multiplier used only if
            apply_preprocessing=True.

    Returns:
        An OCRExtractionResult. Check `.success` before using `.raw_text`.
    """
    languages = languages if languages is not None else list(DEFAULT_LANGUAGES)

    try:
        reader = get_reader(tuple(languages))

        ocr_input: Union[str, "np.ndarray"]
        if apply_preprocessing:
            preprocessed = preprocess_image_for_ocr(image_path, contrast_factor)
            ocr_input = np.array(preprocessed)
        else:
            ocr_input = str(image_path)

        raw_detections = reader.readtext(ocr_input)
    except Exception as exc:  # noqa: BLE001 - intentionally broad: OCR
        # failures must never crash the pipeline (Section 34).
        return OCRExtractionResult(
            success=False,
            raw_text="",
            document_confidence=None,
            regions=[],
            error_message=str(exc),
            languages_used=languages,
            preprocessing_applied=apply_preprocessing,
        )

    regions = [
        DetectedTextRegion(text=text, confidence=confidence, bbox=bbox)
        for (bbox, text, confidence) in raw_detections
    ]
    raw_text = extract_raw_text(raw_detections)
    document_confidence = compute_document_confidence(
        [confidence for (_bbox, _text, confidence) in raw_detections]
    )

    return OCRExtractionResult(
        success=True,
        raw_text=raw_text,
        document_confidence=document_confidence,
        regions=regions,
        error_message=None,
        languages_used=languages,
        preprocessing_applied=apply_preprocessing,
    )


def to_schema_ocr_result(extraction: OCRExtractionResult) -> OCRResult:
    """Convert an internal OCRExtractionResult into the persisted schema type.

    Always produces human_verified=False and verified_text=None,
    regardless of extraction quality. Verification is a separate,
    human-driven step (see project specification, Stage 2) and must
    never be inferred automatically from OCR confidence.
    """
    return OCRResult(
        raw_extracted_text=extraction.raw_text,
        ocr_confidence=extraction.document_confidence,
        human_verified=False,
        verified_text=None,
        verification_operator_note=None,
    )
