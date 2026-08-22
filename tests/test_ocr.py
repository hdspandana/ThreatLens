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

import pytest

import nyayaai.ocr as ocr_module
from nyayaai.ocr import (
    OCRExtractionResult,
    compute_document_confidence,
    extract_raw_text,
    is_low_confidence,
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


class TestRunOcr:
    def test_successful_extraction(self, tmp_path):
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
