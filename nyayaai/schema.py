"""
NyayaAI - Incident Record Schema.

This module defines the central data contract for the entire NyayaAI
system, using Pydantic v2 exclusively (no v1 compatibility code).

The single most important design rule enforced here is provenance
separation (see project specification, Sections 9-11):

    Raw/unverified information
        != Human-verified information
        != User-reported context
        != AI-derived information
        != Official reference information

In particular, `OCRResult.raw_extracted_text` and
`OCRResult.verified_text` are kept as separate fields on purpose.
Downstream modules (signal extraction, risk engine) must only ever
read `verified_text`. This module enforces, via validation, that
`verified_text` cannot be empty whenever `human_verified` is True -
but it does NOT and cannot prevent a careless caller from reading the
wrong field. That discipline must be maintained in every module that
consumes this schema.

No legal content, ML claims, or risk logic lives in this file. This
is a pure data contract.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SCHEMA_VERSION = "1.0.0"


def _utc_now() -> datetime:
    """Return a timezone-aware current UTC timestamp.

    Centralized here so every timestamped field in this schema uses
    the same, non-deprecated approach (datetime.utcnow() is deprecated
    as of Python 3.12).
    """
    return datetime.now(timezone.utc)


class CaseStatus(str, Enum):
    """Lifecycle status of an incident record.

    Maps to the four-stage workflow described in the project
    specification (Preserve -> Extract & Verify -> Analyze -> Document).
    """

    CREATED = "created"
    EVIDENCE_PRESERVED = "evidence_preserved"
    TEXT_VERIFIED = "text_verified"
    ANALYZED = "analyzed"
    DOCUMENTED = "documented"


class RiskLevel(str, Enum):
    """Heuristic risk categories produced by the deterministic risk engine.

    These are heuristic starting categories, not calibrated
    probabilities, and must never be presented as predictions of
    physical danger or criminality.
    """

    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    UNCERTAIN = "UNCERTAIN"


class SignalType(str, Enum):
    """Starter taxonomy of observable signals.

    Intentionally small for the MVP. Expand only using real
    evaluation examples, never speculation.
    """

    THREAT_LANGUAGE = "threat_language"
    SEXUAL_CONTENT = "sexual_content"
    PERSONAL_INFO_EXPOSURE = "personal_info_exposure"
    TARGETED_HARASSMENT = "targeted_harassment"
    OFFENSIVE_LANGUAGE = "offensive_language"
    REPEATED_CONTACT = "repeated_contact"


class SignalSourceType(str, Enum):
    """How a signal was produced.

    RULE_BASED is the default MVP detection path. CLASSIFIER is
    reserved for the prototype classifier module and must not be
    treated as production-grade until fine-tuned and evaluated.
    """

    RULE_BASED = "rule_based"
    CLASSIFIER = "classifier"


class ContextAnswerSource(str, Enum):
    """Provenance tag for context answers.

    For the MVP, all context answers are supplied by the operator
    based on the affected person's statement - never inferred
    automatically.
    """

    USER_REPORTED = "user_reported"


class EvidenceFileType(str, Enum):
    """Allowed evidence file types for the MVP.

    Restricting this at the schema level is a deliberate safety
    constraint, not just an implementation detail.
    """

    PNG = "png"
    JPG = "jpg"
    JPEG = "jpeg"


class OCRResult(BaseModel):
    """OCR output for a single evidence item.

    Enforces the most important provenance rule in the project: raw
    OCR output and human-verified text are structurally separate
    fields. Downstream modules must only ever read `verified_text`.
    """

    model_config = ConfigDict(extra="forbid")

    raw_extracted_text: str = Field(
        default="",
        description=(
            "Unverified text exactly as produced by OCR. May contain "
            "errors. Must never be used directly by signal extraction "
            "or the risk engine."
        ),
    )
    ocr_confidence: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description=(
            "Document-level OCR confidence in the range [0, 1]. The "
            "aggregation method is defined explicitly in nyayaai/ocr.py "
            "and must not be treated as a calibrated probability."
        ),
    )
    human_verified: bool = Field(
        default=False,
        description="True only after an operator has reviewed and confirmed the text.",
    )
    verified_text: Optional[str] = Field(
        default=None,
        description=(
            "Operator-confirmed (and possibly corrected) text. This is "
            "the ONLY text field that may be consumed by downstream "
            "signal extraction and risk logic."
        ),
    )
    verification_operator_note: Optional[str] = Field(
        default=None,
        description="Optional free-text note from the operator made during verification.",
    )

    @model_validator(mode="after")
    def _check_verification_consistency(self) -> "OCRResult":
        """Ensure verified_text is present whenever human_verified is True.

        Prevents a state where the record claims verification happened
        but no verified text was actually recorded.
        """
        if self.human_verified and not self.verified_text:
            raise ValueError(
                "human_verified is True but verified_text is empty. "
                "Verification must include the confirmed text."
            )
        return self


class EvidenceItem(BaseModel):
    """A single piece of preserved evidence."""

    model_config = ConfigDict(extra="forbid")

    evidence_id: str = Field(..., description="Unique identifier for this evidence item.")
    original_filename: str = Field(..., description="Original filename as uploaded by the operator.")
    file_hash_sha256: str = Field(
        ...,
        min_length=64,
        max_length=64,
        description="SHA-256 hash of the original file bytes, used to prove integrity.",
    )
    uploaded_at: datetime = Field(default_factory=_utc_now)
    file_type: EvidenceFileType = Field(..., description="Validated file type of the evidence.")
    storage_path: str = Field(
        ..., description="Local filesystem path where the original file is stored unmodified."
    )
    ocr: OCRResult = Field(default_factory=OCRResult)

    @field_validator("file_hash_sha256")
    @classmethod
    def _validate_hex(cls, v: str) -> str:
        """Confirm the hash is valid hexadecimal and normalize to lowercase."""
        try:
            int(v, 16)
        except ValueError as exc:
            raise ValueError("file_hash_sha256 must be a valid hexadecimal string") from exc
        return v.lower()


class ContextAnswer(BaseModel):
    """A single answer to a context questionnaire item."""

    model_config = ConfigDict(extra="forbid")

    question_id: str
    question_text: str
    answer: str
    answered_by: str = Field(..., description="Identifier of the operator who recorded this answer.")
    source: ContextAnswerSource = Field(default=ContextAnswerSource.USER_REPORTED)


class Signal(BaseModel):
    """A single detected observable signal."""

    model_config = ConfigDict(extra="forbid")

    signal_id: str
    signal_type: SignalType
    source_evidence_id: str = Field(..., description="evidence_id this signal was detected in.")
    source_type: SignalSourceType = Field(default=SignalSourceType.RULE_BASED)
    detection_method: str = Field(
        ..., description="Short description of how this was detected, e.g. 'regex_keyword_match'."
    )
    confidence: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description=(
            "Confidence score, only meaningful for probabilistic detectors. "
            "Deterministic rule-based signals must leave this as None "
            "rather than fabricate a score."
        ),
    )
    matched_span: str = Field(
        ..., description="The exact text span that triggered this signal, taken from verified_text."
    )


class RiskAssessment(BaseModel):
    """Output of the deterministic heuristic risk engine."""

    model_config = ConfigDict(extra="forbid")

    level: RiskLevel
    contributing_signals: List[str] = Field(
        default_factory=list, description="signal_id values that contributed to this assessment."
    )
    contributing_context: List[str] = Field(
        default_factory=list, description="question_id values that contributed to this assessment."
    )
    rule_trace: List[str] = Field(
        default_factory=list,
        description="Plain-language explanation of the decision, e.g. 'threat_language detected'.",
    )
    missing_context_flagged: List[str] = Field(
        default_factory=list,
        description="question_id values whose absence limited confidence in this assessment.",
    )


class LegalReference(BaseModel):
    """A single verified, informational legal reference.

    Every entry represented by this model must be manually verified
    against an authoritative source before inclusion. This schema does
    not verify anything itself - it only records the provenance fields
    required to prove verification happened.
    """

    model_config = ConfigDict(extra="forbid")

    reference_id: str
    behaviour_category: str
    provision: str = Field(
        ..., description="Name of the law and section, e.g. 'Bharatiya Nyaya Sanhita, 2023 - Section X'."
    )
    short_description: str
    official_source: str = Field(..., description="Authoritative source URL or citation, e.g. India Code.")
    verification_date: datetime = Field(
        ..., description="Date this entry was last verified against the official source."
    )
    applicability_note: str = Field(
        ...,
        description="Plain-language note on when this may be relevant. Never phrased as a legal conclusion.",
    )
    limitations: str = Field(..., description="Known limitations or caveats of this reference.")


class LLMSummary(BaseModel):
    """Optional local-LLM-generated summary.

    The LLM is never load-bearing. If generation failed or was
    skipped, `generated` must be False and `summary_text` should hold
    the deterministic fallback text instead.
    """

    model_config = ConfigDict(extra="forbid")

    model_used: Optional[str] = Field(
        default=None, description="Name of the local model used, e.g. 'mistral'. None if not used."
    )
    generated: bool = Field(default=False, description="True only if an actual LLM call succeeded.")
    summary_text: str = Field(default="", description="The summary text, or deterministic fallback template text.")
    source_fields: List[str] = Field(
        default_factory=list,
        description="Names of structured fields the summary was built from, e.g. ['signals', 'risk_assessment'].",
    )


class IncidentRecord(BaseModel):
    """Top-level incident record - the central data contract of NyayaAI."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default=SCHEMA_VERSION)
    case_id: str = Field(..., description="Unique, generated case identifier. Must not be user-controlled input.")
    created_at: datetime = Field(default_factory=_utc_now)
    operator_id: str = Field(..., description="Identifier of the operator/caseworker handling this case.")
    status: CaseStatus = Field(default=CaseStatus.CREATED)

    evidence: List[EvidenceItem] = Field(default_factory=list)
    context_answers: List[ContextAnswer] = Field(default_factory=list)
    signals: List[Signal] = Field(default_factory=list)
    risk_assessment: Optional[RiskAssessment] = Field(default=None)
    legal_references: List[LegalReference] = Field(default_factory=list)
    llm_summary: Optional[LLMSummary] = Field(default=None)

    unverified_operator_notes: Optional[str] = Field(
        default=None,
        description="Free-text operator notes. Explicitly unverified; never fed into automated analysis.",
    )
    limitations_statement: str = Field(
        default=(
            "This record is an AI-assisted documentation aid. It does not "
            "constitute a legal opinion, a police complaint, or "
            "court-certified evidence."
        ),
        description="Standing disclaimer included in every incident record.",
    )