import csv
import re
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.api.deps.auth import get_db, require_admin
from app.models.exam import Exam, Question
from app.models.submission import Submission, is_suspicious_submission_event
from app.models.user import User
from app.schemas.admin import (
    AdminActivityLogRead,
    AdminSubmissionListRead,
    AdminSummaryRead,
    SecurityAlertRead,
    StudentExamHistoryItemRead,
)
from app.services.admin_activity_service import list_admin_activity, log_admin_activity
from app.services.backup_service import generate_database_backup
from app.services.exam_service import get_student_exam_history
from app.services.integrity_service import verify_submission_integrity
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


def _format_proctor_event_label(event_type: str | None) -> str | None:
    if not event_type:
        return None
    labels = {
        "window_blur": "Window switched / lost focus",
        "tab_hidden": "Tab switched / hidden",
        "fullscreen_exit": "Fullscreen exited",
        "keyboard_violation": "Suspicious key / shortcut",
        "auto_submit": "Auto-submitted",
        "copy": "Copy attempt detected",
        "paste": "Paste attempt detected",
        "cut": "Cut attempt detected",
        "page_unload": "Page refresh/close attempt",
        "route_leave": "Exam page leave attempt",
        "logout_during_exam": "Logout during exam",
        "manual_security_lock": "Manual security lock",
        "reopen_attempt": "Exam reopen attempt",
    }
    if event_type in labels:
        return labels[event_type]
    return " ".join(part.capitalize() for part in event_type.split("_") if part)


def _submission_total_marks(submission: Submission) -> int:
    return sum(int(question.marks or 0) for question in submission.exam.questions) if submission.exam else 0


def _event_importance(event) -> int:
    if event.event_type == "auto_submit":
        return 5
    if event.severity == "critical":
        return 4
    if event.event_type == "keyboard_violation":
        return 3
    if event.event_type in {"fullscreen_exit", "tab_hidden", "window_blur", "route_leave", "page_unload"}:
        return 2
    return 1


def _admin_submission_list_item(submission: Submission) -> dict:
    total_marks = _submission_total_marks(submission)
    percentage = (
        round((float(submission.score) / total_marks) * 100, 2)
        if submission.score is not None and total_marks > 0
        else None
    )
    events = list(submission.events or [])
    suspicious_events = [event for event in events if is_suspicious_submission_event(event)]
    top_event = sorted(suspicious_events, key=_event_importance, reverse=True)[0] if suspicious_events else None
    student = submission.student
    exam = submission.exam
    year = student.class_name or student.batch
    suspicious_count = len(suspicious_events)

    return {
        "id": submission.id,
        "submission_id": submission.id,
        "exam_id": submission.exam_id,
        "exam_title": exam.title if exam else f"Exam {submission.exam_id}",
        "exam_subject": exam.subject if exam else None,
        "student_id": submission.student_id,
        "student_name": student.full_name,
        "student_full_name": student.full_name,
        "student_email": student.email,
        "register_number": student.register_number,
        "student_register_number": student.register_number,
        "department": student.department,
        "student_department": student.department,
        "year": year,
        "student_class_name": student.class_name,
        "student_batch": student.batch,
        "status": submission.status.value,
        "score": submission.score,
        "total_marks": total_marks,
        "percentage": percentage,
        "submitted_at": submission.submitted_at,
        "started_at": submission.started_at,
        "is_result_published": bool(exam and exam.is_result_published),
        "integrity_status": submission.integrity_status,
        "cheat_event_count": suspicious_count,
        "suspicious_event_count": suspicious_count,
        "total_events": len(events),
        "suspicious_events": suspicious_count,
        "critical_events": sum(1 for event in suspicious_events if event.severity == "critical"),
        "top_event_type": top_event.event_type if top_event else None,
        "top_event_label": _format_proctor_event_label(top_event.event_type) if top_event else None,
    }


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
    submission_counts_by_exam = {
        exam_id: count
        for exam_id, count in db.execute(
            select(Submission.exam_id, func.count(Submission.id)).group_by(Submission.exam_id)
        ).all()
    }
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
        "submission_counts_by_exam": submission_counts_by_exam,
        "average_score": round(float(average_score), 2) if average_score is not None else None,
    }


@router.get("/submissions", response_model=AdminSubmissionListRead)
def read_admin_submissions(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    exam_id: int | None = None,
    search: str | None = None,
    exam_search: str | None = None,
    status_filter: SubmissionStatus | None = Query(default=None, alias="status"),
    integrity_status: str | None = None,
    result_published: bool | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    filters = []
    if exam_id is not None:
        filters.append(Submission.exam_id == exam_id)
    if status_filter is not None:
        filters.append(Submission.status == status_filter)
    if integrity_status:
        filters.append(Submission.integrity_status == integrity_status.strip().lower())
    if result_published is not None:
        filters.append(Exam.is_result_published.is_(result_published))

    normalized_search = (search or "").strip()
    if normalized_search:
        pattern = f"%{normalized_search}%"
        filters.append(
            or_(
                User.full_name.ilike(pattern),
                User.email.ilike(pattern),
                User.register_number.ilike(pattern),
                Exam.title.ilike(pattern),
            )
        )

    normalized_exam_search = (exam_search or "").strip()
    if normalized_exam_search:
        pattern = f"%{normalized_exam_search}%"
        filters.append(
            or_(
                Exam.title.ilike(pattern),
                Exam.subject.ilike(pattern),
            )
        )

    base_statement = (
        select(Submission)
        .join(Submission.student)
        .join(Submission.exam)
        .where(*filters)
    )
    total = int(
        db.execute(
            select(func.count()).select_from(
                base_statement.with_only_columns(Submission.id).order_by(None).subquery()
            )
        ).scalar_one()
    )
    page_statement = (
        base_statement
        .options(
            selectinload(Submission.student),
            selectinload(Submission.events),
            selectinload(Submission.exam).selectinload(Exam.questions).selectinload(Question.options),
        )
        .order_by(Submission.started_at.desc(), Submission.id.desc())
        .offset(offset)
        .limit(limit)
    )
    submissions = list(db.execute(page_statement).scalars().unique().all())
    integrity_changed = False
    for submission in submissions:
        integrity_changed = verify_submission_integrity(db, submission) or integrity_changed
    if integrity_changed:
        db.commit()

    return {
        "items": [_admin_submission_list_item(submission) for submission in submissions],
        "total": total,
        "limit": limit,
        "offset": offset,
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


@router.get("/backups/download")
def download_database_backup(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required.",
        )

    try:
        backup = generate_database_backup()
    except (RuntimeError, SQLAlchemyError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to generate database backup.",
        ) from exc

    log_admin_activity(
        db=db,
        admin=current_user,
        action="database_backup_downloaded",
        entity_type="backup",
        details={
            "filename": backup.filename,
            "exported_tables": backup.table_names,
            "row_counts": backup.row_counts,
        },
    )

    return Response(
        content=backup.content,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{backup.filename}"'},
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
