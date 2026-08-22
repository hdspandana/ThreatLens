"""
Tests for nyayaai/evidence.py.

Uses pytest's tmp_path fixture so every test writes to an isolated
temporary directory - never to the real data/evidence_store/.
"""

import pytest

from nyayaai.evidence import (
    EmptyFileError,
    FileTooLargeError,
    UnsupportedFileTypeError,
    EvidenceIngestionError,
    compute_sha256,
    ingest_evidence,
    validate_file_size,
    validate_file_type,
)
from nyayaai.schema import EvidenceFileType

SAMPLE_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"fake png body for testing"


class TestComputeSha256:
    def test_hash_is_deterministic(self):
        assert compute_sha256(b"hello") == compute_sha256(b"hello")

    def test_hash_changes_with_content(self):
        assert compute_sha256(b"hello") != compute_sha256(b"world")

    def test_hash_is_64_char_lowercase_hex(self):
        h = compute_sha256(b"hello")
        assert len(h) == 64
        assert h == h.lower()
        int(h, 16)  # raises ValueError if not valid hex


class TestValidateFileType:
    def test_png_accepted(self):
        assert validate_file_type("screenshot.png") == EvidenceFileType.PNG

    def test_jpg_accepted(self):
        assert validate_file_type("photo.jpg") == EvidenceFileType.JPG

    def test_jpeg_case_insensitive(self):
        assert validate_file_type("photo.JPEG") == EvidenceFileType.JPEG

    def test_unsupported_extension_raises(self):
        with pytest.raises(UnsupportedFileTypeError):
            validate_file_type("document.pdf")

    def test_no_extension_raises(self):
        with pytest.raises(UnsupportedFileTypeError):
            validate_file_type("noextension")


class TestValidateFileSize:
    def test_empty_file_raises(self):
        with pytest.raises(EmptyFileError):
            validate_file_size(b"")

    def test_normal_file_passes(self):
        validate_file_size(b"some bytes")  # should not raise

    def test_oversized_file_raises(self):
        with pytest.raises(FileTooLargeError):
            validate_file_size(b"x" * 100, max_bytes=50)


class TestIngestEvidence:
    def test_ingest_creates_evidence_item(self, tmp_path):
        item = ingest_evidence(
            case_id="case-test-1",
            original_filename="screenshot.png",
            data=SAMPLE_PNG_BYTES,
            base_dir=tmp_path,
        )
        assert item.original_filename == "screenshot.png"
        assert item.file_type == EvidenceFileType.PNG
        assert item.file_hash_sha256 == compute_sha256(SAMPLE_PNG_BYTES)
        assert item.ocr.human_verified is False

    def test_ingest_writes_file_unmodified(self, tmp_path):
        item = ingest_evidence(
            case_id="case-test-2",
            original_filename="screenshot.png",
            data=SAMPLE_PNG_BYTES,
            base_dir=tmp_path,
        )
        saved_path = tmp_path / "case-test-2" / f"{item.evidence_id}.png"
        assert saved_path.exists()
        assert saved_path.read_bytes() == SAMPLE_PNG_BYTES

    def test_ingest_rejects_unsupported_type(self, tmp_path):
        with pytest.raises(UnsupportedFileTypeError):
            ingest_evidence(
                case_id="case-test-3",
                original_filename="evidence.pdf",
                data=b"some pdf bytes",
                base_dir=tmp_path,
            )

    def test_ingest_rejects_empty_file(self, tmp_path):
        with pytest.raises(EmptyFileError):
            ingest_evidence(
                case_id="case-test-4",
                original_filename="screenshot.png",
                data=b"",
                base_dir=tmp_path,
            )

    def test_ingest_multiple_files_same_case(self, tmp_path):
        item1 = ingest_evidence(
            case_id="case-test-5",
            original_filename="one.png",
            data=b"first image bytes",
            base_dir=tmp_path,
        )
        item2 = ingest_evidence(
            case_id="case-test-5",
            original_filename="two.jpg",
            data=b"second image bytes",
            base_dir=tmp_path,
        )
        assert item1.evidence_id != item2.evidence_id
        assert item1.file_hash_sha256 != item2.file_hash_sha256

        case_dir = tmp_path / "case-test-5"
        saved_files = list(case_dir.iterdir())
        assert len(saved_files) == 2

    def test_identical_content_gets_unique_evidence_ids(self, tmp_path):
        """Even if two uploads have identical bytes, each gets a
        unique evidence_id and is stored as a separate file. Hashes
        will match (correctly - same content), but identity does not."""
        item1 = ingest_evidence(
            case_id="case-test-6",
            original_filename="dup1.png",
            data=SAMPLE_PNG_BYTES,
            base_dir=tmp_path,
        )
        item2 = ingest_evidence(
            case_id="case-test-6",
            original_filename="dup2.png",
            data=SAMPLE_PNG_BYTES,
            base_dir=tmp_path,
        )
        assert item1.evidence_id != item2.evidence_id
        assert item1.file_hash_sha256 == item2.file_hash_sha256

    def test_ingest_rejects_path_traversal_case_id(self, tmp_path):
        with pytest.raises(EvidenceIngestionError):
            ingest_evidence(
                case_id="../../evil",
                original_filename="screenshot.png",
                data=SAMPLE_PNG_BYTES,
                base_dir=tmp_path,
            )