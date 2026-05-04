from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps.auth import get_db, require_admin
from app.models.exam import Exam
from app.models.submission import Submission
from app.models.user import User
from app.schemas.admin import AdminActivityLogRead, AdminSummaryRead
from app.services.admin_activity_service import list_admin_activity
from app.utils.enums import SubmissionStatus, UserRole

router = APIRouter(prefix="/admin", tags=["admin"])


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
