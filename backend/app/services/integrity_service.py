import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.submission import Submission, SubmissionAnswer
from app.services.security_alert_service import create_security_alert_once


INTEGRITY_STATUS_UNVERIFIED = "unverified"
INTEGRITY_STATUS_VERIFIED = "verified"
INTEGRITY_STATUS_TAMPERED = "tampered"
RESULT_INTEGRITY_ALERT_TYPE = "result_integrity_mismatch"


def _datetime_to_canonical(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat()
    return value.astimezone(timezone.utc).isoformat()


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def build_submission_integrity_payload(submission: Submission, answers: list[SubmissionAnswer]) -> dict[str, Any]:
    ordered_answers = sorted(
        answers,
        key=lambda answer: (
            answer.question_id if answer.question_id is not None else 0,
            answer.id if answer.id is not None else 0,
        ),
    )

    return {
        "submission_id": submission.id,
        "exam_id": submission.exam_id,
        "student_id": submission.student_id,
        "status": _enum_value(submission.status),
        "score": submission.score,
        "started_at": _datetime_to_canonical(submission.started_at),
        "submitted_at": _datetime_to_canonical(submission.submitted_at),
        "answers": [
            {
                "question_id": answer.question_id,
                "selected_option_id": answer.selected_option_id,
                "correct_option_id": answer.correct_option_id,
                "is_correct": answer.is_correct,
                "marks_awarded": answer.marks_awarded,
                "marked_for_review": answer.is_marked_for_review,
            }
            for answer in ordered_answers
        ],
    }


def calculate_submission_hmac(payload: dict[str, Any], secret: str) -> str:
    canonical_payload = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hmac.new(
        secret.encode("utf-8"),
        canonical_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def seal_submission_integrity(db: Session, submission: Submission) -> Submission:
    db.flush()
    now = datetime.now(timezone.utc)
    payload = build_submission_integrity_payload(submission, list(submission.answers))
    submission.integrity_hash = calculate_submission_hmac(payload, settings.integrity_secret_key)
    submission.integrity_status = INTEGRITY_STATUS_VERIFIED
    submission.integrity_sealed_at = now
    submission.integrity_checked_at = now
    db.add(submission)
    db.flush()
    return submission


def verify_submission_integrity(db: Session, submission: Submission) -> bool:
    now = datetime.now(timezone.utc)
    changed = False

    if not submission.integrity_hash:
        if submission.integrity_status != INTEGRITY_STATUS_UNVERIFIED:
            submission.integrity_status = INTEGRITY_STATUS_UNVERIFIED
            changed = True
        if submission.integrity_checked_at is None:
            submission.integrity_checked_at = now
            changed = True
        if changed:
            db.add(submission)
            db.flush()
        return changed

    payload = build_submission_integrity_payload(submission, list(submission.answers))
    expected_hash = calculate_submission_hmac(payload, settings.integrity_secret_key)
    next_status = (
        INTEGRITY_STATUS_VERIFIED
        if hmac.compare_digest(expected_hash, submission.integrity_hash)
        else INTEGRITY_STATUS_TAMPERED
    )

    if submission.integrity_status != next_status:
        submission.integrity_status = next_status
        changed = True
    submission.integrity_checked_at = now
    changed = True

    if next_status == INTEGRITY_STATUS_TAMPERED:
        create_security_alert_once(
            db=db,
            severity="critical",
            alert_type=RESULT_INTEGRITY_ALERT_TYPE,
            title="Result integrity mismatch detected",
            message=(
                "Submission result-critical data no longer matches its HMAC integrity seal. "
                "Review the submission before trusting this result."
            ),
            entity_type="submission",
            entity_id=submission.id,
            metadata={
                "submission_id": submission.id,
                "exam_id": submission.exam_id,
                "student_id": submission.student_id,
            },
        )
        changed = True

    if changed:
        db.add(submission)
        db.flush()

    return changed
