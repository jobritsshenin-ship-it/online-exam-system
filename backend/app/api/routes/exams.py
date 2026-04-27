from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, get_db, require_admin
from app.models.user import User
from app.schemas.exam import (
    ExamAdminRead,
    ExamCreate,
    ExamPublish,
    ExamRead,
    ExamUpdate,
    QuestionAdminRead,
    QuestionBulkCreate,
    QuestionCreate,
    SavedAnswerRequest,
    SubmissionCreate,
    SubmissionEventCreate,
    SubmissionRead,
)
from app.services.exam_service import (
    add_question,
    add_questions_bulk,
    create_exam,
    delete_question,
    get_exam,
    list_exam_submissions,
    list_exams,
    list_my_submissions,
    record_proctor_event,
    save_answer,
    set_exam_published,
    start_exam,
    submit_exam,
    update_exam,
    update_question,
)

router = APIRouter(prefix="/exams", tags=["exams"])


def _raise_not_found(exc: LookupError):
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=str(exc),
    ) from exc


def _raise_bad_request(exc: ValueError):
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=str(exc),
    ) from exc


@router.get("", response_model=list[ExamRead])
def read_exams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return list_exams(db, current_user)


@router.post("", response_model=ExamAdminRead, status_code=status.HTTP_201_CREATED)
def create_new_exam(
    payload: ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return create_exam(db, payload, current_user)


@router.patch("/{exam_id}", response_model=ExamAdminRead)
def update_existing_exam(
    exam_id: int,
    payload: ExamUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return update_exam(db, exam_id, payload, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.get("/submissions/me", response_model=list[SubmissionRead])
def read_my_submissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return list_my_submissions(db, current_user)


@router.get("/{exam_id}", response_model=ExamRead)
def read_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return get_exam(db, exam_id, current_user)
    except LookupError as exc:
        _raise_not_found(exc)


@router.get("/{exam_id}/admin", response_model=ExamAdminRead)
def read_exam_for_admin(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return get_exam(db, exam_id, current_user)
    except LookupError as exc:
        _raise_not_found(exc)


@router.patch("/{exam_id}/publish", response_model=ExamAdminRead)
def update_exam_publish_status(
    exam_id: int,
    payload: ExamPublish,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return set_exam_published(db, exam_id, payload.is_published, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/questions", response_model=QuestionAdminRead, status_code=status.HTTP_201_CREATED)
def create_exam_question(
    exam_id: int,
    payload: QuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return add_question(db, exam_id, payload, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/questions/bulk", response_model=list[QuestionAdminRead], status_code=status.HTTP_201_CREATED)
def create_exam_questions_bulk(
    exam_id: int,
    payload: QuestionBulkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return add_questions_bulk(db, exam_id, payload, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.put("/{exam_id}/questions/{question_id}", response_model=QuestionAdminRead)
def update_exam_question(
    exam_id: int,
    question_id: int,
    payload: QuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return update_question(db, exam_id, question_id, payload, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.delete("/{exam_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam_question(
    exam_id: int,
    question_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        delete_question(db, exam_id, question_id, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/start", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def start_exam_attempt(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return start_exam(db, exam_id, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/answers", response_model=SubmissionRead)
def save_exam_answer(
    exam_id: int,
    payload: SavedAnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return save_answer(db, exam_id, payload, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/submit", response_model=SubmissionRead)
def submit_exam_attempt(
    exam_id: int,
    payload: SubmissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return submit_exam(db, exam_id, payload, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/proctoring-events", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
def record_exam_proctor_event(
    exam_id: int,
    payload: SubmissionEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return record_proctor_event(db, exam_id, payload, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.get("/{exam_id}/submissions", response_model=list[SubmissionRead])
def read_exam_submissions(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return list_exam_submissions(db, exam_id, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
