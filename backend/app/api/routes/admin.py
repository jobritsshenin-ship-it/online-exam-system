import csv
import re
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps.auth import get_db, require_admin
from app.models.exam import Exam
from app.models.submission import Submission
from app.models.user import User
from app.schemas.admin import (
    AdminActivityLogRead,
    AdminSummaryRead,
    SecurityAlertRead,
    StudentExamHistoryItemRead,
)
from app.services.admin_activity_service import list_admin_activity
from app.services.exam_service import get_student_exam_history
from app.services.security_alert_service import list_security_alerts, resolve_security_alert
from app.utils.enums import SubmissionStatus, UserRole

router = APIRouter(prefix="/admin", tags=["admin"])
STUDENT_HISTORY_CSV_COLUMNS = [
    "student_name",
    "email",
    "register_number",
    "department",
    "year",
    "exam_title",
    "exam_subject",
    "status",
    "score",
    "total_marks",
    "percentage",
    "pass_fail",
    "started_at",
    "submitted_at",
    "result_published",
    "integrity_status",
]


def _safe_csv_filename_part(value: str | int | None) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or "").strip()).strip("_")
    return cleaned or "student"


def _student_history_csv_rows(history: list[dict]) -> list[dict]:
    return [
        {
            "student_name": item["student_name"],
            "email": item["student_email"],
            "register_number": item["register_number"] or "",
            "department": item["department"] or "",
            "year": item["year"] or "",
            "exam_title": item["exam_title"],
            "exam_subject": item["exam_subject"] or "",
            "status": item["status"],
            "score": item["score"] if item["score"] is not None else "",
            "total_marks": item["total_marks"],
            "percentage": item["percentage"] if item["percentage"] is not None else "",
            "pass_fail": item["pass_fail"],
            "started_at": item["started_at"].isoformat() if item["started_at"] else "",
            "submitted_at": item["submitted_at"].isoformat() if item["submitted_at"] else "",
            "result_published": "Yes" if item["is_result_published"] else "No",
            "integrity_status": item["integrity_status"],
        }
        for item in history
    ]


@router.get("/summary", response_model=AdminSummaryRead)
def read_admin_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    total_exams = int(db.execute(select(func.count()).select_from(Exam)).scalar_one())
    archived_exams = int(
        db.execute(select(func.count()).select_from(Exam).where(Exam.is_archived.is_(True))).scalar_one()
    )
    published_exams = int(
        db.execute(
            select(func.count()).select_from(Exam).where(
                Exam.is_published.is_(True),
                Exam.is_archived.is_(False),
            )
        ).scalar_one()
    )
    total_students = int(
        db.execute(select(func.count()).select_from(User).where(User.role == UserRole.STUDENT)).scalar_one()
    )
    total_admins = int(
        db.execute(select(func.count()).select_from(User).where(User.role == UserRole.ADMIN)).scalar_one()
    )
    total_submissions = int(db.execute(select(func.count()).select_from(Submission)).scalar_one())
    average_score = db.execute(
        select(func.avg(Submission.score)).where(
            Submission.status == SubmissionStatus.SUBMITTED,
            Submission.score.is_not(None),
        )
    ).scalar_one()

    return {
        "total_exams": total_exams,
        "published_exams": published_exams,
        "draft_exams": total_exams - published_exams - archived_exams,
        "archived_exams": archived_exams,
        "total_students": total_students,
        "total_admins": total_admins,
        "total_submissions": total_submissions,
        "average_score": round(float(average_score), 2) if average_score is not None else None,
    }


@router.get("/activity", response_model=list[AdminActivityLogRead])
def read_admin_activity(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = None,
    entity_type: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return list_admin_activity(
        db=db,
        limit=limit,
        offset=offset,
        action=action,
        entity_type=entity_type,
    )


@router.get("/students/{student_id}/exam-history", response_model=list[StudentExamHistoryItemRead])
def read_student_exam_history(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        _, history = get_student_exam_history(db, student_id, current_user)
        return history
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/students/{student_id}/exam-history.csv")
def download_student_exam_history_csv(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        student, history = get_student_exam_history(db, student_id, current_user)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=STUDENT_HISTORY_CSV_COLUMNS)
    writer.writeheader()
    writer.writerows(_student_history_csv_rows(history))

    filename_key = _safe_csv_filename_part(student.register_number or student.id)
    filename = f"student_exam_history_{filename_key}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/security-alerts", response_model=list[SecurityAlertRead])
def read_security_alerts(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    severity: str | None = None,
    is_resolved: bool | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return list_security_alerts(
        db=db,
        limit=limit,
        offset=offset,
        severity=severity,
        is_resolved=is_resolved,
    )


@router.patch("/security-alerts/{alert_id}/resolve", response_model=SecurityAlertRead)
def resolve_admin_security_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return resolve_security_alert(db, alert_id, current_user)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
