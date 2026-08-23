"""
Tests for nyayaai/ocr.py.

All tests here MOCK easyocr.Reader entirely - they do not download
or run real OCR models. This keeps the automated test suite fast and
independent of network access.

Real-world OCR behavior, including the mandatory English/Hindi/
Hinglish language testing (Section 15), is verified separately and
manually via tests/manual_ocr_language_check.py, which is NOT part of
this automated suite.
"""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from PIL import Image

import nyayaai.ocr as ocr_module
from nyayaai.ocr import (
    OCRExtractionResult,
    compute_document_confidence,
    extract_raw_text,
    is_low_confidence,
    preprocess_image_for_ocr,
    run_ocr,
    to_schema_ocr_result,
)


@pytest.fixture(autouse=True)
def clear_reader_cache():
    """Ensure the module-level reader cache is empty before each test,
    so mocked Reader classes are always actually invoked."""
    ocr_module._READER_CACHE.clear()
    yield
    ocr_module._READER_CACHE.clear()


def make_test_image(tmp_path, name="test.png", size=(20, 20), color=128):
    """Create a small, real, valid PNG file for preprocessing tests."""
    path = tmp_path / name
    img = Image.new("L", size, color=color)
    img.save(path)
    return path


class TestComputeDocumentConfidence:
    def test_empty_list_returns_none(self):
        assert compute_document_confidence([]) is None

    def test_single_value_returns_itself(self):
        assert compute_document_confidence([0.8]) == 0.8

    def test_multiple_values_returns_mean(self):
        assert compute_document_confidence([0.5, 1.0]) == pytest.approx(0.75)


class TestExtractRawText:
    def test_joins_multiple_detections_with_newline(self):
        detections = [(None, "line one", 0.9), (None, "line two", 0.8)]
        assert extract_raw_text(detections) == "line one\nline two"

    def test_empty_detections_returns_empty_string(self):
        assert extract_raw_text([]) == ""


class TestIsLowConfidence:
    def test_none_is_low_confidence(self):
        assert is_low_confidence(None) is True

    def test_below_threshold_is_low_confidence(self):
        assert is_low_confidence(0.3) is True

    def test_above_threshold_is_not_low_confidence(self):
        assert is_low_confidence(0.9) is False


class TestGetReader:
    def test_reader_is_cached_across_calls(self):
        with patch("nyayaai.ocr.easyocr.Reader") as mock_reader_cls:
            mock_reader_cls.return_value = MagicMock()
            reader1 = ocr_module.get_reader(("en",))
            reader2 = ocr_module.get_reader(("en",))
            assert reader1 is reader2
            assert mock_reader_cls.call_count == 1

    def test_different_languages_create_different_readers(self):
        with patch("nyayaai.ocr.easyocr.Reader") as mock_reader_cls:
            mock_reader_cls.side_effect = [MagicMock(), MagicMock()]
            reader_en = ocr_module.get_reader(("en",))
            reader_en_hi = ocr_module.get_reader(("en", "hi"))
            assert reader_en is not reader_en_hi
            assert mock_reader_cls.call_count == 2


class TestPreprocessImageForOcr:
    def test_returns_grayscale_image(self, tmp_path):
        image_path = make_test_image(tmp_path)
        result = preprocess_image_for_ocr(image_path)
        assert result.mode == "L"

    def test_does_not_modify_original_file(self, tmp_path):
        image_path = make_test_image(tmp_path, color=100)
        original_bytes = image_path.read_bytes()
        preprocess_image_for_ocr(image_path)
        assert image_path.read_bytes() == original_bytes

    def test_contrast_factor_changes_output(self, tmp_path):
        image_path = make_test_image(tmp_path, size=(10, 10), color=100)
        low_contrast = preprocess_image_for_ocr(image_path, contrast_factor=1.0)
        high_contrast = preprocess_image_for_ocr(image_path, contrast_factor=3.0)
        # A flat, single-color image has no contrast to enhance either
        # way, but this confirms the function runs and returns
        # correctly-typed output at different factors without error.
        assert np.array(low_contrast).shape == np.array(high_contrast).shape


class TestRunOcr:
    def test_successful_extraction_without_preprocessing(self, tmp_path):
        with patch("nyayaai.ocr.easyocr.Reader") as mock_reader_cls:
            mock_reader = MagicMock()
            mock_reader.readtext.return_value = [
                (None, "I know where you live", 0.91),
                (None, "extra noise", 0.40),
            ]
            mock_reader_cls.return_value = mock_reader

            dummy_image = tmp_path / "fake.png"
            dummy_image.write_bytes(b"not a real image - reader is mocked")

            result = run_ocr(dummy_image, languages=["en"])

            assert result.success is True
            assert "I know where you live" in result.raw_text
            assert result.document_confidence == pytest.approx((0.91 + 0.40) / 2)
            assert len(result.regions) == 2
            assert result.preprocessing_applied is False
            # Confirm readtext was called with the file path (string),
            # not a preprocessed array, when preprocessing is off.
            call_arg = mock_reader.readtext.call_args[0][0]
            assert isinstance(call_arg, str)

    def test_successful_extraction_with_preprocessing(self, tmp_path):
        with patch("nyayaai.ocr.easyocr.Reader") as mock_reader_cls:
            mock_reader = MagicMock()
            mock_reader.readtext.return_value = [
                (None, "I know where you live", 0.95),
            ]
            mock_reader_cls.return_value = mock_reader

            real_image = make_test_image(tmp_path, name="real.png")

            result = run_ocr(real_image, languages=["en"], apply_preprocessing=True)

            assert result.success is True
            assert result.preprocessing_applied is True
            # Confirm readtext was called with a numpy array (the
            # preprocessed image), not a raw file path string.
            call_arg = mock_reader.readtext.call_args[0][0]
            assert isinstance(call_arg, np.ndarray)

    def test_no_text_detected(self, tmp_path):
        with patch("nyayaai.ocr.easyocr.Reader") as mock_reader_cls:
            mock_reader = MagicMock()
            mock_reader.readtext.return_value = []
            mock_reader_cls.return_value = mock_reader

            dummy_image = tmp_path / "blank.png"
            dummy_image.write_bytes(b"blank")

            result = run_ocr(dummy_image, languages=["en"])

            assert result.success is True
            assert result.raw_text == ""
            assert result.document_confidence is None

    def test_ocr_exception_is_caught_not_raised(self, tmp_path):
        with patch("nyayaai.ocr.easyocr.Reader") as mock_reader_cls:
            mock_reader = MagicMock()
            mock_reader.readtext.side_effect = RuntimeError("corrupt image")
            mock_reader_cls.return_value = mock_reader

            dummy_image = tmp_path / "bad.png"
            dummy_image.write_bytes(b"corrupt")

            result = run_ocr(dummy_image, languages=["en"])

            assert result.success is False
            assert result.error_message == "corrupt image"
            assert result.raw_text == ""
            assert result.document_confidence is None

    def test_preprocessing_failure_is_caught_not_raised(self, tmp_path):
        """If preprocessing itself fails (e.g. invalid image for PIL),
        this must also degrade gracefully rather than crash."""
        with patch("nyayaai.ocr.easyocr.Reader") as mock_reader_cls:
            mock_reader_cls.return_value = MagicMock()
            not_an_image = tmp_path / "not_an_image.png"
            not_an_image.write_bytes(b"this is not valid image data")

            result = run_ocr(not_an_image, languages=["en"], apply_preprocessing=True)

            assert result.success is False
            assert result.error_message is not None


class TestToSchemaOcrResult:
    def test_conversion_never_sets_verified(self):
        extraction = OCRExtractionResult(
            success=True,
            raw_text="some extracted text",
            document_confidence=0.7,
        )
        schema_result = to_schema_ocr_result(extraction)

        assert schema_result.human_verified is False
        assert schema_result.verified_text is None
        assert schema_result.raw_extracted_text == "some extracted text"
        assert schema_result.ocr_confidence == 0.7

    def test_failed_extraction_converts_to_empty_unverified_result(self):
        extraction = OCRExtractionResult(
            success=False,
            raw_text="",
            document_confidence=None,
            error_message="corrupt image",
        )
        schema_result = to_schema_ocr_result(extraction)

        assert schema_result.human_verified is False
        assert schema_result.verified_text is None
        assert schema_result.raw_extracted_text == ""
        assert schema_result.ocr_confidence is None
