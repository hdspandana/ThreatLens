"""
NyayaAI - Evidence Ingestion.

Implements Section 13 of the project specification. This module:
    - validates uploaded file type and size,
    - computes a SHA-256 integrity hash over the raw bytes,
    - saves the original file bytes completely unmodified to local
      storage,
    - constructs a validated EvidenceItem (see nyayaai/schema.py).

This module performs NO network calls, NO image modification, and
does not run OCR (see nyayaai/ocr.py for that, added in a later
phase). SHA-256 proves the stored bytes have not changed since
intake - it proves nothing about the truth of the file's content.
"""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

from nyayaai.schema import EvidenceFileType, EvidenceItem, OCRResult

MAX_EVIDENCE_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

_EXTENSION_TO_FILE_TYPE = {
    "png": EvidenceFileType.PNG,
    "jpg": EvidenceFileType.JPG,
    "jpeg": EvidenceFileType.JPEG,
}

DEFAULT_EVIDENCE_STORE_DIR = Path("data") / "evidence_store"


class EvidenceIngestionError(Exception):
    """Base class for all evidence ingestion failures."""


class UnsupportedFileTypeError(EvidenceIngestionError):
    """Raised when a file extension is not in the allowed set."""


class EmptyFileError(EvidenceIngestionError):
    """Raised when the uploaded file has zero bytes."""


class FileTooLargeError(EvidenceIngestionError):
    """Raised when the uploaded file exceeds MAX_EVIDENCE_FILE_SIZE_BYTES."""


def compute_sha256(data: bytes) -> str:
    """Compute the SHA-256 hash of raw bytes, returned as lowercase hex.

    This hash proves the stored evidence bytes are identical to what
    was originally uploaded. It does not, and cannot, prove anything
    about whether the content itself is genuine or accurate.
    """
    return hashlib.sha256(data).hexdigest()


def _extract_extension(filename: str) -> str:
    """Return the lowercase file extension (without the dot), or '' if none."""
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def validate_file_type(filename: str) -> EvidenceFileType:
    """Validate the filename's extension against allowed evidence types.

    Raises:
        UnsupportedFileTypeError: if the extension is not png/jpg/jpeg.
    """
    ext = _extract_extension(filename)
    if ext not in _EXTENSION_TO_FILE_TYPE:
        allowed = ", ".join(sorted(_EXTENSION_TO_FILE_TYPE))
        raise UnsupportedFileTypeError(
            f"Unsupported file type '{ext or '(none)'}' for '{filename}'. "
            f"Allowed types: {allowed}."
        )
    return _EXTENSION_TO_FILE_TYPE[ext]


def validate_file_size(
    data: bytes, max_bytes: int = MAX_EVIDENCE_FILE_SIZE_BYTES
) -> None:
    """Validate the uploaded file is non-empty and within the size limit.

    Raises:
        EmptyFileError: if data has zero length.
        FileTooLargeError: if data exceeds max_bytes.
    """
    if len(data) == 0:
        raise EmptyFileError("Uploaded file is empty (0 bytes).")
    if len(data) > max_bytes:
        raise FileTooLargeError(
            f"Uploaded file is {len(data)} bytes, which exceeds the "
            f"maximum allowed size of {max_bytes} bytes."
        )


def _sanitize_case_id(case_id: str) -> str:
    """Reject case IDs that could enable path traversal.

    Case IDs are expected to be system-generated (e.g. UUIDs) by a
    trusted case-creation step, never raw user input. This check
    exists as defense in depth, not as the primary safeguard.
    """
    if not case_id or ".." in case_id or "/" in case_id or "\\" in case_id:
        raise EvidenceIngestionError(f"Invalid case_id: '{case_id}'")
    return case_id


def save_evidence_file(
    case_id: str,
    evidence_id: str,
    file_type: EvidenceFileType,
    data: bytes,
    base_dir: Path = DEFAULT_EVIDENCE_STORE_DIR,
) -> Path:
    """Save the original evidence bytes, unmodified, to disk.

    Files are stored as:
        <base_dir>/<case_id>/<evidence_id>.<extension>

    The generated evidence_id is used as the filename - never the
    operator-supplied original filename - to prevent path traversal
    and filename collisions.

    Returns:
        The path the file was written to.
    """
    case_id = _sanitize_case_id(case_id)
    case_dir = base_dir / case_id
    case_dir.mkdir(parents=True, exist_ok=True)

    file_path = case_dir / f"{evidence_id}.{file_type.value}"
    file_path.write_bytes(data)
    return file_path


def ingest_evidence(
    case_id: str,
    original_filename: str,
    data: bytes,
    base_dir: Path = DEFAULT_EVIDENCE_STORE_DIR,
) -> EvidenceItem:
    """Validate, hash, preserve, and record a single piece of evidence.

    Performs no network calls and does not modify the original file
    bytes. Does not run OCR - that happens separately (nyayaai/ocr.py).

    Args:
        case_id: System-generated case identifier (not raw user input).
        original_filename: Filename as provided by the operator. Used
            only for validation and record-keeping - never as the
            on-disk filename.
        data: Raw file bytes.
        base_dir: Root directory for evidence storage. Overridable for
            testing.

    Returns:
        A validated EvidenceItem with an empty (unverified) OCRResult.

    Raises:
        UnsupportedFileTypeError, EmptyFileError, FileTooLargeError,
        EvidenceIngestionError.
    """
    file_type = validate_file_type(original_filename)
    validate_file_size(data)

    evidence_id = str(uuid.uuid4())
    file_hash = compute_sha256(data)
    storage_path = save_evidence_file(case_id, evidence_id, file_type, data, base_dir)

    return EvidenceItem(
        evidence_id=evidence_id,
        original_filename=original_filename,
        file_hash_sha256=file_hash,
        file_type=file_type,
        storage_path=str(storage_path),
        ocr=OCRResult(),
    )
