"""
Tests for nyayaai/schema.py.

These tests verify the schema's structural guarantees BEFORE any
other module (evidence, ocr, signals, risk_engine) is built on top of
it. In particular, we verify the provenance-separation rule: an
OCRResult cannot claim human_verified=True without actual verified
text present.
"""

import pytest
from pydantic import ValidationError

from nyayaai.schema import (
    CaseStatus,
    ContextAnswer,
    ContextAnswerSource,
    EvidenceFileType,
    EvidenceItem,
    IncidentRecord,
    LegalReference,
    LLMSummary,
    OCRResult,
    RiskAssessment,
    RiskLevel,
    Signal,
    SignalSourceType,
    SignalType,
)

VALID_SHA256 = "a" * 64


def make_minimal_evidence_item() -> EvidenceItem:
    """Helper: construct a minimal, valid EvidenceItem for reuse across tests."""
    return EvidenceItem(
        evidence_id="ev-1",
        original_filename="screenshot.png",
        file_hash_sha256=VALID_SHA256,
        file_type=EvidenceFileType.PNG,
        storage_path="data/evidence_store/case-1/ev-1.png",
    )


class TestOCRResult:
    def test_default_ocr_result_is_unverified(self):
        ocr = OCRResult()
        assert ocr.human_verified is False
        assert ocr.verified_text is None
        assert ocr.raw_extracted_text == ""

    def test_verified_true_without_text_raises(self):
        """This is the core provenance safety rule: cannot claim
        verification happened without actual verified text."""
        with pytest.raises(ValidationError):
            OCRResult(human_verified=True, verified_text=None)

    def test_verified_true_with_empty_string_raises(self):
        with pytest.raises(ValidationError):
            OCRResult(human_verified=True, verified_text="")

    def test_verified_true_with_text_succeeds(self):
        ocr = OCRResult(
            raw_extracted_text="I knw wher you liv",
            ocr_confidence=0.62,
            human_verified=True,
            verified_text="I know where you live",
        )
        assert ocr.human_verified is True
        assert ocr.verified_text == "I know where you live"

    def test_confidence_out_of_range_raises(self):
        with pytest.raises(ValidationError):
            OCRResult(ocr_confidence=1.5)
        with pytest.raises(ValidationError):
            OCRResult(ocr_confidence=-0.1)


class TestEvidenceItem:
    def test_valid_evidence_item(self):
        item = make_minimal_evidence_item()
        assert item.file_type == EvidenceFileType.PNG
        assert item.ocr.human_verified is False  # default OCRResult

    def test_invalid_hash_length_raises(self):
        with pytest.raises(ValidationError):
            EvidenceItem(
                evidence_id="ev-1",
                original_filename="x.png",
                file_hash_sha256="not64chars",
                file_type=EvidenceFileType.PNG,
                storage_path="data/evidence_store/x.png",
            )

    def test_invalid_hash_non_hex_raises(self):
        with pytest.raises(ValidationError):
            EvidenceItem(
                evidence_id="ev-1",
                original_filename="x.png",
                file_hash_sha256="z" * 64,  # 'z' is not valid hex
                file_type=EvidenceFileType.PNG,
                storage_path="data/evidence_store/x.png",
            )

    def test_hash_is_lowercased(self):
        item = EvidenceItem(
            evidence_id="ev-1",
            original_filename="x.png",
            file_hash_sha256="A" * 64,
            file_type=EvidenceFileType.PNG,
            storage_path="data/evidence_store/x.png",
        )
        assert item.file_hash_sha256 == "a" * 64

    def test_unexpected_extra_field_rejected(self):
        """extra='forbid' must actually reject unknown fields."""
        with pytest.raises(ValidationError):
            EvidenceItem(
                evidence_id="ev-1",
                original_filename="x.png",
                file_hash_sha256=VALID_SHA256,
                file_type=EvidenceFileType.PNG,
                storage_path="data/evidence_store/x.png",
                totally_unexpected_field="should fail",
            )


class TestSignal:
    def test_signal_confidence_can_be_none(self):
        """Deterministic rule-based signals must be allowed to have no
        fabricated confidence score."""
        signal = Signal(
            signal_id="sig-1",
            signal_type=SignalType.THREAT_LANGUAGE,
            source_evidence_id="ev-1",
            source_type=SignalSourceType.RULE_BASED,
            detection_method="regex_keyword_match",
            confidence=None,
            matched_span="I know where you live",
        )
        assert signal.confidence is None

    def test_signal_confidence_out_of_range_raises(self):
        with pytest.raises(ValidationError):
            Signal(
                signal_id="sig-1",
                signal_type=SignalType.THREAT_LANGUAGE,
                source_evidence_id="ev-1",
                detection_method="regex_keyword_match",
                confidence=1.2,
                matched_span="x",
            )


class TestRiskAssessment:
    def test_uncertain_risk_with_rule_trace(self):
        risk = RiskAssessment(
            level=RiskLevel.UNCERTAIN,
            contributing_signals=["sig-1"],
            contributing_context=[],
            rule_trace=[
                "threat language detected",
                "joke marker detected",
                "previous-contact context missing",
            ],
            missing_context_flagged=["previous_contact"],
        )
        assert risk.level == RiskLevel.UNCERTAIN
        assert "previous_contact" in risk.missing_context_flagged


class TestContextAnswer:
    def test_default_source_is_user_reported(self):
        answer = ContextAnswer(
            question_id="q1",
            question_text="Has this person contacted you before?",
            answer="Yes, multiple times",
            answered_by="operator-42",
        )
        assert answer.source == ContextAnswerSource.USER_REPORTED


class TestIncidentRecord:
    def test_minimal_valid_record(self):
        record = IncidentRecord(
            case_id="case-0001",
            operator_id="operator-42",
        )
        assert record.status == CaseStatus.CREATED
        assert record.evidence == []
        assert record.risk_assessment is None
        assert "does not constitute a legal opinion" in record.limitations_statement

    def test_full_record_round_trip_json(self):
        """Confirm a fully populated record serializes and deserializes
        correctly - this matters because storage.py will rely on
        exactly this behavior."""
        record = IncidentRecord(
            case_id="case-0002",
            operator_id="operator-42",
            status=CaseStatus.ANALYZED,
            evidence=[make_minimal_evidence_item()],
            context_answers=[
                ContextAnswer(
                    question_id="q1",
                    question_text="Has this happened before?",
                    answer="Yes",
                    answered_by="operator-42",
                )
            ],
            signals=[
                Signal(
                    signal_id="sig-1",
                    signal_type=SignalType.THREAT_LANGUAGE,
                    source_evidence_id="ev-1",
                    detection_method="regex_keyword_match",
                    matched_span="I know where you live",
                )
            ],
            risk_assessment=RiskAssessment(
                level=RiskLevel.HIGH,
                contributing_signals=["sig-1"],
                rule_trace=["threat_language detected"],
            ),
            legal_references=[
                LegalReference(
                    reference_id="ref-1",
                    behaviour_category="threat_language",
                    provision="Placeholder - not yet verified",
                    short_description="Placeholder entry for schema testing only.",
                    official_source="https://www.indiacode.nic.in/",
                    verification_date="2024-07-01T00:00:00Z",
                    applicability_note="This behaviour category may be relevant to the following provision.",
                    limitations="This is test data, not a verified legal reference.",
                )
            ],
            llm_summary=LLMSummary(generated=False, summary_text="Fallback template summary."),
        )

        json_str = record.model_dump_json()
        reloaded = IncidentRecord.model_validate_json(json_str)

        assert reloaded.case_id == "case-0002"
        assert reloaded.status == CaseStatus.ANALYZED
        assert len(reloaded.evidence) == 1
        assert reloaded.risk_assessment.level == RiskLevel.HIGH
        assert reloaded.legal_references[0].reference_id == "ref-1"

    def test_unexpected_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            IncidentRecord(
                case_id="case-0003",
                operator_id="operator-42",
                not_a_real_field="should fail",
            )