from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, get_db, require_admin, require_student
from app.models.user import User
from app.schemas.exam import (
    ExamAdminRead,
    ExamArchive,
    AutoSubmitRequest,
    ExamCreate,
    ExamPublish,
    ExamResultPublish,
    ExamRead,
    ExamUpdate,
    QuestionAdminRead,
    QuestionBulkCreate,
    QuestionCreate,
    QuestionImportResult,
    SavedAnswerRequest,
    SubmissionCreate,
    SubmissionEventCreate,
    SubmissionRead,
    StudentSubmissionRead,
)
from app.services.exam_service import (
    add_question,
    add_questions_bulk,
    create_exam,
    delete_exam,
    delete_question,
    force_submit_exam,
    get_submission,
    get_exam,
    import_questions_from_docx,
    list_exam_submissions,
    list_exams,
    list_my_submissions,
    record_proctor_event,
    save_answer,
    set_exam_archived,
    set_exam_published,
    set_exam_result_published,
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


def _student_submission_response(submission) -> dict:
    is_result_published = bool(submission.exam and submission.exam.is_result_published)
    return {
        "id": submission.id,
        "exam_id": submission.exam_id,
        "student_id": submission.student_id,
        "status": submission.status,
        "score": submission.score if is_result_published else None,
        "started_at": submission.started_at,
        "submitted_at": submission.submitted_at,
        "is_result_published": is_result_published,
        "result_message": (
            "Results have been published."
            if is_result_published
            else (
                "Your exam has been submitted successfully. Results will be published by the admin later."
                if submission.status.value == "submitted"
                else "Results will be published by the admin after this exam is submitted."
            )
        ),
        "answers": [
            {
                "id": answer.id,
                "question_id": answer.question_id,
                "question_prompt": answer.question_prompt,
                "selected_option_id": answer.selected_option_id,
                "selected_option_text": answer.selected_option_text,
                "is_marked_for_review": answer.is_marked_for_review,
            }
            for answer in submission.answers
        ],
    }


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


@router.get("/submissions/me", response_model=list[StudentSubmissionRead])
def read_my_submissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    return [_student_submission_response(submission) for submission in list_my_submissions(db, current_user)]


@router.get("/submissions/{submission_id}", response_model=SubmissionRead)
def read_submission_detail(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return get_submission(db, submission_id, current_user)
    except LookupError as exc:
        _raise_not_found(exc)


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


@router.patch("/{exam_id}/results-publish", response_model=ExamAdminRead)
def update_exam_result_publish_status(
    exam_id: int,
    payload: ExamResultPublish,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return set_exam_result_published(db, exam_id, payload.is_result_published, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.patch("/{exam_id}/archive", response_model=ExamAdminRead)
def update_exam_archive_status(
    exam_id: int,
    payload: ExamArchive,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return set_exam_archived(db, exam_id, payload.is_archived, current_user)
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        delete_exam(db, exam_id, current_user)
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


@router.post("/{exam_id}/questions/import-docx", response_model=QuestionImportResult)
async def import_exam_questions_from_docx(
    exam_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    filename = (file.filename or "").lower()
    if not filename.endswith(".docx"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .docx files are supported.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded Word file is empty.",
        )

    try:
        return import_questions_from_docx(db, exam_id, content, current_user)
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


@router.post("/{exam_id}/start", response_model=StudentSubmissionRead, status_code=status.HTTP_201_CREATED)
def start_exam_attempt(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    try:
        return _student_submission_response(start_exam(db, exam_id, current_user))
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/answers", response_model=StudentSubmissionRead)
def save_exam_answer(
    exam_id: int,
    payload: SavedAnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    try:
        return _student_submission_response(save_answer(db, exam_id, payload, current_user))
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/submit", response_model=StudentSubmissionRead)
def submit_exam_attempt(
    exam_id: int,
    payload: SubmissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    try:
        return _student_submission_response(submit_exam(db, exam_id, payload, current_user))
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/auto-submit", response_model=StudentSubmissionRead)
def auto_submit_exam_attempt(
    exam_id: int,
    payload: AutoSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    try:
        return _student_submission_response(force_submit_exam(db, exam_id, payload, current_user))
    except LookupError as exc:
        _raise_not_found(exc)
    except ValueError as exc:
        _raise_bad_request(exc)


@router.post("/{exam_id}/proctoring-events", response_model=StudentSubmissionRead, status_code=status.HTTP_201_CREATED)
def record_exam_proctor_event(
    exam_id: int,
    payload: SubmissionEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    try:
        return _student_submission_response(record_proctor_event(db, exam_id, payload, current_user))
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
