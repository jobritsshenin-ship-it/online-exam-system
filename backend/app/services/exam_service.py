import json
import re
from io import BytesIO
from datetime import datetime, timedelta, timezone

from docx import Document
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.exam import Exam, Question, QuestionOption
from app.models.submission import Submission, SubmissionAnswer, SubmissionEvent
from app.models.user import User
from app.redis.client import set_value
from app.schemas.exam import (
    AutoSubmitRequest,
    ExamCreate,
    ExamUpdate,
    QuestionBulkCreate,
    QuestionCreate,
    QuestionImportBlockResult,
    QuestionImportResult,
    SavedAnswerRequest,
    SubmissionCreate,
    SubmissionEventCreate,
)
from app.services.integrity_service import seal_submission_integrity, verify_submission_integrity
from app.utils.enums import QuestionType, SubmissionStatus, UserRole


def _exam_options():
    return (selectinload(Exam.questions).selectinload(Question.options),)


def _submission_options():
    return (
        selectinload(Submission.student),
        selectinload(Submission.events),
        selectinload(Submission.answers).selectinload(SubmissionAnswer.selected_option),
        selectinload(Submission.answers)
        .selectinload(SubmissionAnswer.question)
        .selectinload(Question.options),
        selectinload(Submission.exam).selectinload(Exam.questions).selectinload(Question.options),
    )


def _validate_question(question_in: QuestionCreate) -> None:
    if question_in.question_type != QuestionType.MCQ:
        raise ValueError("Only multiple-choice questions are supported right now.")

    if not question_in.prompt or not question_in.prompt.strip():
        raise ValueError("Question prompt cannot be blank.")

    non_empty_options = [option for option in question_in.options if option.text and option.text.strip()]
    if len(non_empty_options) < 2:
        raise ValueError("A multiple-choice question needs at least two non-empty options.")

    correct_count = sum(1 for option in non_empty_options if option.is_correct)
    if correct_count != 1:
        raise ValueError("A multiple-choice question needs exactly one correct option.")


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _build_question(exam_id: int, question_in: QuestionCreate) -> Question:
    _validate_question(question_in)
    question = Question(
        exam_id=exam_id,
        prompt=question_in.prompt.strip(),
        explanation=question_in.explanation.strip() if question_in.explanation else None,
        question_type=question_in.question_type,
        marks=question_in.marks,
        sort_order=question_in.sort_order,
    )
    question.options = [
        QuestionOption(
            text=option.text.strip(),
            is_correct=option.is_correct,
            sort_order=option.sort_order,
        )
        for option in question_in.options
        if option.text and option.text.strip()
    ]
    return question


def _referenced_option_ids(db: Session, option_ids: list[int]) -> set[int]:
    if not option_ids:
        return set()

    statement = select(SubmissionAnswer.selected_option_id).where(
        SubmissionAnswer.selected_option_id.in_(option_ids)
    )
    return {option_id for option_id in db.execute(statement).scalars().all() if option_id is not None}


def _has_answers_for_question(db: Session, question_id: int) -> bool:
    statement = select(SubmissionAnswer.id).where(SubmissionAnswer.question_id == question_id).limit(1)
    return db.execute(statement).scalar_one_or_none() is not None


def _sync_question_options(db: Session, question: Question, question_in: QuestionCreate) -> None:
    existing_options = sorted(question.options, key=lambda option: (option.sort_order, option.id or 0))
    existing_by_id = {option.id: option for option in existing_options if option.id is not None}
    next_options: list[QuestionOption] = []
    used_option_ids: set[int] = set()

    for index, option_in in enumerate(question_in.options):
        option = None
        if option_in.id is not None:
            if option_in.id in used_option_ids:
                raise ValueError("Question option ids must be unique.")
            option = existing_by_id.get(option_in.id)
            if option is None:
                raise ValueError("Question option not found for this question.")
        elif index < len(existing_options):
            candidate = existing_options[index]
            if candidate.id not in used_option_ids:
                option = candidate

        if option is None:
            option = QuestionOption()

        option.text = option_in.text.strip()
        option.is_correct = option_in.is_correct
        option.sort_order = option_in.sort_order
        next_options.append(option)
        if option.id is not None:
            used_option_ids.add(option.id)

    removed_option_ids = [
        option.id
        for option in existing_options
        if option.id is not None and option.id not in used_option_ids
    ]
    referenced_option_ids = _referenced_option_ids(db, removed_option_ids)
    if referenced_option_ids:
        raise ValueError(
            "Cannot remove options from a question that already has submitted answers. "
            "Edit the existing option text instead."
        )

    question.options = next_options


def _ensure_draft_exam(exam: Exam) -> None:
    if exam.is_published:
        raise ValueError("Published exams cannot be edited. Unpublish this exam first.")


def _to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def _get_submission_deadline(submission: Submission, exam: Exam) -> datetime:
    started_at = _to_utc(submission.started_at)
    deadline = started_at + timedelta(minutes=exam.duration_minutes)
    exam_ends_at = _to_utc(exam.ends_at)

    if exam_ends_at and exam_ends_at < deadline:
        return exam_ends_at

    return deadline


def _ensure_submission_not_expired(submission: Submission, exam: Exam) -> None:
    deadline = _get_submission_deadline(submission, exam)
    now = datetime.now(timezone.utc)
    if now > deadline:
        raise ValueError("Exam time has expired.")


def _ensure_exam_window_open(exam: Exam) -> None:
    now = datetime.now(timezone.utc)
    starts_at = _to_utc(exam.starts_at)
    ends_at = _to_utc(exam.ends_at)

    if starts_at and now < starts_at:
        raise ValueError("This exam has not started yet.")

    if ends_at and now > ends_at:
        raise ValueError("This exam has ended.")


def _validate_exam_ready_for_publish(exam: Exam) -> None:
    if not exam.title or not exam.title.strip():
        raise ValueError("Exam title is required before publishing.")

    if not exam.duration_minutes or exam.duration_minutes < 1:
        raise ValueError("Exam duration must be at least 1 minute.")

    if exam.starts_at and exam.ends_at and exam.starts_at >= exam.ends_at:
        raise ValueError("Exam start time must be before end time.")

    if not exam.questions:
        raise ValueError("Add at least one question before publishing.")

    for index, question in enumerate(exam.questions, start=1):
        if not question.prompt or not question.prompt.strip():
            raise ValueError(f"Question {index} has no prompt.")

        non_empty_options = [option for option in question.options if option.text and option.text.strip()]
        if len(non_empty_options) < 2:
            raise ValueError(f"Question {index} must have at least two non-empty options.")

        correct_count = sum(1 for option in non_empty_options if option.is_correct)
        if correct_count != 1:
            raise ValueError(f"Question {index} must have exactly one correct option.")


def _cache_exam_session(submission: Submission, exam: Exam) -> None:
    deadline = _get_submission_deadline(submission, exam)
    now = datetime.now(timezone.utc)
    remaining_seconds = int((deadline - now).total_seconds())

    if remaining_seconds <= 0:
        return

    payload = {
        "submission_id": submission.id,
        "exam_id": exam.id,
        "student_id": submission.student_id,
        "started_at": submission.started_at.isoformat() if submission.started_at else None,
        "duration_minutes": exam.duration_minutes,
        "deadline": deadline.isoformat(),
    }

    set_value(
        key=f"exam_session:{submission.id}",
        value=json.dumps(payload),
        expiry_seconds=remaining_seconds,
    )


def _get_active_submission(db: Session, exam_id: int, student_id: int) -> Submission | None:
    statement = (
        select(Submission)
        .where(
            Submission.exam_id == exam_id,
            Submission.student_id == student_id,
            Submission.status == SubmissionStatus.IN_PROGRESS,
        )
        .options(*_submission_options())
    )
    return db.execute(statement).scalars().unique().one_or_none()


def _get_submitted_submission(db: Session, exam_id: int, student_id: int) -> Submission | None:
    statement = (
        select(Submission)
        .where(
            Submission.exam_id == exam_id,
            Submission.student_id == student_id,
            Submission.status == SubmissionStatus.SUBMITTED,
        )
        .options(*_submission_options())
    )
    return db.execute(statement).scalars().unique().one_or_none()


def _get_answer_for_question(submission: Submission, question_id: int) -> SubmissionAnswer | None:
    return next((answer for answer in submission.answers if answer.question_id == question_id), None)


def _validate_answer_target(
    exam: Exam,
    question_id: int,
    selected_option_id: int | None,
) -> tuple[Question, QuestionOption | None]:
    question = next((item for item in exam.questions if item.id == question_id), None)
    if not question:
        raise ValueError("This question does not belong to the selected exam.")

    if selected_option_id is None:
        return question, None

    option = next((item for item in question.options if item.id == selected_option_id), None)
    if not option:
        raise ValueError("This option does not belong to the selected question.")

    return question, option


def _upsert_answer(
    submission: Submission,
    exam: Exam,
    question_id: int,
    selected_option_id: int | None,
    is_marked_for_review: bool,
) -> SubmissionAnswer:
    question, option = _validate_answer_target(exam, question_id, selected_option_id)
    answer = _get_answer_for_question(submission, question.id)
    is_correct = bool(option and option.is_correct)
    marks_awarded = question.marks if is_correct else 0

    if answer is None:
        answer = SubmissionAnswer(
            question_id=question.id,
            selected_option_id=option.id if option else None,
            is_correct=is_correct,
            marks_awarded=marks_awarded,
            is_marked_for_review=is_marked_for_review,
        )
        submission.answers.append(answer)
    else:
        answer.selected_option_id = option.id if option else None
        answer.is_correct = is_correct
        answer.marks_awarded = marks_awarded
        answer.is_marked_for_review = is_marked_for_review

    return answer


def _upsert_submission_answers(
    submission: Submission,
    exam: Exam,
    answers: list,
    preserve_review_flags: bool = True,
) -> None:
    incoming_question_ids = set()
    for answer in answers:
        if answer.question_id in incoming_question_ids:
            raise ValueError("Each question can only be answered once.")
        incoming_question_ids.add(answer.question_id)
        existing = _get_answer_for_question(submission, answer.question_id)
        _upsert_answer(
            submission=submission,
            exam=exam,
            question_id=answer.question_id,
            selected_option_id=answer.selected_option_id,
            is_marked_for_review=(
                existing.is_marked_for_review
                if preserve_review_flags and existing
                else False
            ),
        )


def _auto_submit_submission(
    db: Session,
    submission: Submission,
    exam: Exam,
    reason: str,
    answers: list | None = None,
) -> Submission:
    if submission.status == SubmissionStatus.SUBMITTED:
        return get_submission(db, submission.id, submission.student)

    if answers:
        _upsert_submission_answers(submission, exam, answers)

    submission.score = sum(answer.marks_awarded for answer in submission.answers)
    submission.status = SubmissionStatus.SUBMITTED
    submission.submitted_at = datetime.now(timezone.utc)

    event = SubmissionEvent(
        submission_id=submission.id,
        event_type="auto_submit",
        severity="critical",
        details=reason,
        metadata_json=None,
    )
    db.add(event)
    db.add(submission)
    seal_submission_integrity(db, submission)
    db.commit()
    return get_submission(db, submission.id, submission.student)


def list_exams(db: Session, current_user: User) -> list[Exam]:
    statement = select(Exam).options(*_exam_options()).order_by(Exam.created_at.desc())
    if current_user.role != UserRole.ADMIN:
        statement = statement.where(
            Exam.is_published.is_(True),
            Exam.is_archived.is_(False),
        )
    return list(db.execute(statement).scalars().unique().all())


def get_exam(db: Session, exam_id: int, current_user: User) -> Exam:
    statement = select(Exam).where(Exam.id == exam_id).options(*_exam_options())
    exam = db.execute(statement).scalars().unique().one_or_none()
    if not exam:
        raise LookupError("Exam not found.")

    if current_user.role != UserRole.ADMIN and (not exam.is_published or exam.is_archived):
        raise LookupError("Exam not found.")

    return exam


def create_exam(db: Session, exam_in: ExamCreate, created_by: User) -> Exam:
    exam = Exam(
        title=exam_in.title,
        subject=exam_in.subject,
        description=_clean_optional_text(exam_in.description),
        instructions=_clean_optional_text(exam_in.instructions),
        duration_minutes=exam_in.duration_minutes,
        starts_at=exam_in.starts_at,
        ends_at=exam_in.ends_at,
        is_published=False,
        is_archived=False,
        is_result_published=False,
        created_by_id=created_by.id,
    )

    db.add(exam)
    db.commit()
    db.refresh(exam)
    return get_exam(db, exam.id, created_by)


def update_exam(db: Session, exam_id: int, exam_in: ExamUpdate, current_user: User) -> Exam:
    exam = get_exam(db, exam_id, current_user)
    _ensure_draft_exam(exam)

    updates = exam_in.model_dump(exclude_unset=True)
    for field in ("description", "instructions"):
        if field in updates:
            updates[field] = _clean_optional_text(updates[field])

    for field, value in updates.items():
        setattr(exam, field, value)

    db.add(exam)
    db.commit()
    return get_exam(db, exam.id, current_user)


def set_exam_published(db: Session, exam_id: int, is_published: bool, current_user: User) -> Exam:
    exam = get_exam(db, exam_id, current_user)
    if is_published:
        if exam.is_archived:
            raise ValueError("Archived exams cannot be published. Unarchive this exam first.")
        _validate_exam_ready_for_publish(exam)

    exam.is_published = is_published

    db.add(exam)
    db.commit()
    return get_exam(db, exam.id, current_user)


def set_exam_result_published(db: Session, exam_id: int, is_result_published: bool, current_user: User) -> Exam:
    exam = get_exam(db, exam_id, current_user)
    exam.is_result_published = is_result_published

    db.add(exam)
    db.commit()
    return get_exam(db, exam.id, current_user)


def set_exam_archived(db: Session, exam_id: int, is_archived: bool, current_user: User) -> Exam:
    exam = get_exam(db, exam_id, current_user)
    exam.is_archived = is_archived
    if is_archived:
        exam.is_published = False

    db.add(exam)
    db.commit()
    return get_exam(db, exam.id, current_user)


def delete_exam(db: Session, exam_id: int, current_user: User) -> None:
    exam = get_exam(db, exam_id, current_user)
    submission_statement = select(Submission.id).where(Submission.exam_id == exam.id).limit(1)
    if db.execute(submission_statement).scalar_one_or_none() is not None:
        raise ValueError("This exam has submissions and cannot be deleted. Archive it instead.")

    db.delete(exam)
    db.commit()


def add_question(db: Session, exam_id: int, question_in: QuestionCreate, current_user: User) -> Question:
    exam = get_exam(db, exam_id, current_user)
    _ensure_draft_exam(exam)

    question = _build_question(exam.id, question_in)
    db.add(question)
    db.commit()

    statement = (
        select(Question)
        .where(Question.id == question.id)
        .options(selectinload(Question.options))
    )
    return db.execute(statement).scalars().unique().one()


def update_question(
    db: Session,
    exam_id: int,
    question_id: int,
    question_in: QuestionCreate,
    current_user: User,
) -> Question:
    exam = get_exam(db, exam_id, current_user)
    _ensure_draft_exam(exam)
    _validate_question(question_in)

    question = next((item for item in exam.questions if item.id == question_id), None)
    if not question:
        raise LookupError("Question not found.")

    question.prompt = question_in.prompt.strip()
    question.explanation = question_in.explanation.strip() if question_in.explanation else None
    question.question_type = question_in.question_type
    question.marks = question_in.marks
    question.sort_order = question_in.sort_order
    _sync_question_options(db, question, question_in)

    db.add(question)
    db.commit()

    statement = (
        select(Question)
        .where(Question.id == question.id)
        .options(selectinload(Question.options))
    )
    return db.execute(statement).scalars().unique().one()


def delete_question(db: Session, exam_id: int, question_id: int, current_user: User) -> None:
    exam = get_exam(db, exam_id, current_user)
    _ensure_draft_exam(exam)

    question = next((item for item in exam.questions if item.id == question_id), None)
    if not question:
        raise LookupError("Question not found.")

    if _has_answers_for_question(db, question.id):
        raise ValueError(
            "Cannot delete a question that already has submitted answers. "
            "Edit the question instead."
        )

    db.delete(question)
    db.commit()


QUESTION_LINE_RE = re.compile(r"^Q(?:uestion)?\s*(\d+)[\).:\-]?\s*(.+)$", re.IGNORECASE)
OPTION_LINE_RE = re.compile(r"^([A-Da-d])[\).:\-]\s*(.+)$")
ANSWER_LINE_RE = re.compile(r"^Answer\s*:\s*(.+)$", re.IGNORECASE)
MARKS_LINE_RE = re.compile(r"^Marks?\s*:\s*(.+)$", re.IGNORECASE)
EXPLANATION_LINE_RE = re.compile(r"^Explanation\s*:\s*(.*)$", re.IGNORECASE)


def _docx_paragraphs(content: bytes) -> list[str]:
    document = Document(BytesIO(content))
    lines: list[str] = []
    for paragraph in document.paragraphs:
        lines.extend(line.strip() for line in paragraph.text.splitlines() if line.strip())
    return lines


def _split_docx_question_blocks(lines: list[str]) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if QUESTION_LINE_RE.match(line):
            if current:
                blocks.append(current)
            current = [line]
        elif current:
            current.append(line)
        else:
            continue

    if current:
        blocks.append(current)

    return blocks


def _resolve_correct_option(answer: str, option_labels: list[str], option_texts: list[str]) -> int | None:
    normalized_answer = answer.strip()
    if not normalized_answer:
        return None

    lower_answer = normalized_answer.lower()
    prefixed_letter = re.match(r"^(?:option\s*)?([a-d])(?:[\).:\-]|\s|$)", lower_answer)
    if prefixed_letter:
        option_index = ord(prefixed_letter.group(1)) - ord("a")
        return option_index if option_index < len(option_texts) and option_texts[option_index].strip() else None

    option_lookup = {label.lower(): index for index, label in enumerate(option_labels)}
    option_lookup.update({str(index + 1): index for index in range(len(option_texts))})
    option_lookup.update({f"option{index + 1}": index for index in range(len(option_texts))})
    if lower_answer in option_lookup:
        option_index = option_lookup[lower_answer]
        return option_index if option_index < len(option_texts) and option_texts[option_index].strip() else None

    for index, text in enumerate(option_texts):
        if text.strip() == normalized_answer:
            return index

    return None


def _question_from_docx_block(block: list[str], block_number: int) -> tuple[QuestionCreate | None, QuestionImportBlockResult]:
    question_text = ""
    options_by_label: dict[str, str] = {}
    answer = ""
    marks_raw = ""
    explanation_parts: list[str] = []
    current_field = ""

    for line in block:
        question_match = QUESTION_LINE_RE.match(line)
        option_match = OPTION_LINE_RE.match(line)
        answer_match = ANSWER_LINE_RE.match(line)
        marks_match = MARKS_LINE_RE.match(line)
        explanation_match = EXPLANATION_LINE_RE.match(line)

        if question_match:
            question_text = question_match.group(2).strip()
            current_field = "question"
        elif option_match:
            label = option_match.group(1).upper()
            options_by_label[label] = option_match.group(2).strip()
            current_field = f"option:{label}"
        elif answer_match:
            answer = answer_match.group(1).strip()
            current_field = "answer"
        elif marks_match:
            marks_raw = marks_match.group(1).strip()
            current_field = "marks"
        elif explanation_match:
            explanation_parts = [explanation_match.group(1).strip()] if explanation_match.group(1).strip() else []
            current_field = "explanation"
        elif current_field == "question":
            question_text = f"{question_text} {line}".strip()
        elif current_field.startswith("option:"):
            label = current_field.split(":", 1)[1]
            options_by_label[label] = f"{options_by_label.get(label, '')} {line}".strip()
        elif current_field == "explanation":
            explanation_parts.append(line)

    errors: list[str] = []
    if not question_text:
        errors.append("question is required")

    option_labels = ["A", "B", "C", "D"]
    option_texts = [options_by_label.get(label, "").strip() for label in option_labels]
    non_empty_options = [option for option in option_texts if option]
    if len(non_empty_options) < 2:
        errors.append("at least 2 options are required")

    if not answer:
        errors.append("Answer is required")
        correct_index = None
    else:
        correct_index = _resolve_correct_option(answer, option_labels, option_texts)
        if correct_index is None:
            errors.append("Answer must match A-D, 1-4, option1-option4, or an option text")

    if marks_raw:
        try:
            marks = int(marks_raw)
        except ValueError:
            marks = 0
            errors.append("Marks must be a whole number")
    else:
        marks = 1
    if marks < 1:
        errors.append("Marks must be at least 1")

    if errors:
        return None, QuestionImportBlockResult(
            block_number=block_number,
            question=question_text or None,
            valid=False,
            errors=errors,
        )

    try:
        question = QuestionCreate(
            prompt=question_text,
            explanation=" ".join(part for part in explanation_parts if part).strip() or None,
            question_type=QuestionType.MCQ,
            marks=marks,
            sort_order=block_number,
            options=[
                {
                    "text": text,
                    "is_correct": index == correct_index,
                    "sort_order": index + 1,
                }
                for index, text in enumerate(option_texts)
                if text
            ],
        )
    except (ValidationError, ValueError) as exc:
        return None, QuestionImportBlockResult(
            block_number=block_number,
            question=question_text or None,
            valid=False,
            errors=[str(exc)],
        )

    return question, QuestionImportBlockResult(
        block_number=block_number,
        question=question_text,
        valid=True,
        errors=[],
    )


def import_questions_from_docx(
    db: Session,
    exam_id: int,
    content: bytes,
    current_user: User,
) -> QuestionImportResult:
    exam = get_exam(db, exam_id, current_user)
    _ensure_draft_exam(exam)

    try:
        lines = _docx_paragraphs(content)
    except Exception as exc:
        raise ValueError("The Word file could not be read. Upload a valid .docx file.") from exc
    blocks = _split_docx_question_blocks(lines)
    if not blocks:
        return QuestionImportResult(
            valid_count=0,
            invalid_count=1,
            created_count=0,
            blocks=[
                QuestionImportBlockResult(
                    block_number=1,
                    valid=False,
                    errors=["No question blocks found in the Word file."],
                )
            ],
        )

    parsed_questions: list[QuestionCreate] = []
    block_results: list[QuestionImportBlockResult] = []
    for index, block in enumerate(blocks, start=1):
        question, result = _question_from_docx_block(block, index)
        block_results.append(result)
        if question:
            parsed_questions.append(question)

    invalid_count = sum(1 for result in block_results if not result.valid)
    if invalid_count:
        return QuestionImportResult(
            valid_count=len(parsed_questions),
            invalid_count=invalid_count,
            created_count=0,
            blocks=block_results,
        )

    current_question_count = len(exam.questions)
    questions = []
    for index, question_in in enumerate(parsed_questions, start=1):
        question_in.sort_order = current_question_count + index
        questions.append(_build_question(exam.id, question_in))

    db.add_all(questions)
    db.commit()

    return QuestionImportResult(
        valid_count=len(parsed_questions),
        invalid_count=0,
        created_count=len(questions),
        blocks=block_results,
    )


def add_questions_bulk(
    db: Session,
    exam_id: int,
    payload: QuestionBulkCreate,
    current_user: User,
) -> list[Question]:
    exam = get_exam(db, exam_id, current_user)
    _ensure_draft_exam(exam)

    questions = [_build_question(exam.id, question_in) for question_in in payload.questions]
    db.add_all(questions)
    db.commit()

    statement = (
        select(Question)
        .where(Question.exam_id == exam.id)
        .options(selectinload(Question.options))
        .order_by(Question.sort_order, Question.id)
    )
    return list(db.execute(statement).scalars().unique().all())


def start_exam(db: Session, exam_id: int, student: User) -> Submission:
    exam = get_exam(db, exam_id, student)
    if not exam.is_published:
        raise ValueError("This exam is not available.")

    _ensure_exam_window_open(exam)

    if not exam.questions:
        raise ValueError("This exam has no questions yet.")

    existing_submission = _get_active_submission(db, exam.id, student.id)
    if existing_submission:
        _auto_submit_submission(
            db=db,
            submission=existing_submission,
            exam=exam,
            reason="reopen_attempt",
        )
        raise ValueError("This exam attempt was already started and cannot be reopened.")

    if _get_submitted_submission(db, exam.id, student.id):
        raise ValueError("You have already submitted this exam.")

    submission = Submission(
        exam_id=exam.id,
        student_id=student.id,
        status=SubmissionStatus.IN_PROGRESS,
    )
    db.add(submission)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing_submission = _get_active_submission(db, exam.id, student.id)
        if existing_submission:
            _auto_submit_submission(
                db=db,
                submission=existing_submission,
                exam=exam,
                reason="reopen_attempt",
            )
            raise ValueError("This exam attempt was already started and cannot be reopened.")
        raise ValueError("You have already started or submitted this exam.")

    saved_submission = get_submission(db, submission.id, student)
    _cache_exam_session(saved_submission, exam)
    return saved_submission


def save_answer(
    db: Session,
    exam_id: int,
    answer_in: SavedAnswerRequest,
    student: User,
) -> Submission:
    exam = get_exam(db, exam_id, student)
    submission = _get_active_submission(db, exam.id, student.id)
    if not submission:
        raise ValueError("Start this exam before saving answers.")

    _ensure_submission_not_expired(submission, exam)

    _upsert_answer(
        submission=submission,
        exam=exam,
        question_id=answer_in.question_id,
        selected_option_id=answer_in.selected_option_id,
        is_marked_for_review=answer_in.is_marked_for_review,
    )

    db.add(submission)
    db.commit()
    return get_submission(db, submission.id, student)


def submit_exam(
    db: Session,
    exam_id: int,
    submission_in: SubmissionCreate,
    student: User,
) -> Submission:
    exam = get_exam(db, exam_id, student)
    submission = _get_active_submission(db, exam.id, student.id)
    if not submission:
        raise ValueError("Start this exam before submitting answers.")

    _ensure_submission_not_expired(submission, exam)

    _upsert_submission_answers(submission, exam, submission_in.answers)

    answers_by_question_id = {
        answer.question_id: answer for answer in submission.answers if answer.selected_option_id is not None
    }
    missing_questions = [
        question.id for question in exam.questions if question.id not in answers_by_question_id
    ]
    if missing_questions:
        raise ValueError("Answer every question before submitting the exam.")

    submission.score = sum(answer.marks_awarded for answer in submission.answers)
    submission.status = SubmissionStatus.SUBMITTED
    submission.submitted_at = datetime.now(timezone.utc)

    db.add(submission)
    seal_submission_integrity(db, submission)
    db.commit()
    return get_submission(db, submission.id, student)


def force_submit_exam(
    db: Session,
    exam_id: int,
    submission_in: AutoSubmitRequest,
    student: User,
) -> Submission:
    exam = get_exam(db, exam_id, student)
    active_submission = _get_active_submission(db, exam.id, student.id)
    if active_submission:
        return _auto_submit_submission(
            db=db,
            submission=active_submission,
            exam=exam,
            reason=submission_in.reason,
            answers=submission_in.answers,
        )

    submitted_submission = _get_submitted_submission(db, exam.id, student.id)
    if submitted_submission:
        return submitted_submission

    raise ValueError("Start this exam before auto-submitting.")


def record_proctor_event(
    db: Session,
    exam_id: int,
    event_in: SubmissionEventCreate,
    student: User,
) -> Submission:
    exam = get_exam(db, exam_id, student)
    submission = _get_active_submission(db, exam.id, student.id)
    if not submission:
        raise ValueError("Start this exam before reporting exam activity.")

    _ensure_submission_not_expired(submission, exam)

    event = SubmissionEvent(
        submission_id=submission.id,
        event_type=event_in.event_type,
        details=event_in.details,
        severity=event_in.severity,
        metadata_json=event_in.metadata_json,
    )
    db.add(event)
    db.commit()
    return get_submission(db, submission.id, student)


def get_submission(db: Session, submission_id: int, current_user: User) -> Submission:
    statement = select(Submission).where(Submission.id == submission_id).options(*_submission_options())
    submission = db.execute(statement).scalars().unique().one_or_none()
    if not submission:
        raise LookupError("Submission not found.")

    if current_user.role != UserRole.ADMIN and submission.student_id != current_user.id:
        raise LookupError("Submission not found.")

    if current_user.role == UserRole.ADMIN and verify_submission_integrity(db, submission):
        db.commit()

    return submission


def list_my_submissions(db: Session, student: User) -> list[Submission]:
    statement = (
        select(Submission)
        .where(Submission.student_id == student.id)
        .options(*_submission_options())
        .order_by(Submission.started_at.desc())
    )
    return list(db.execute(statement).scalars().unique().all())


def list_exam_submissions(db: Session, exam_id: int, current_user: User) -> list[Submission]:
    get_exam(db, exam_id, current_user)
    statement = (
        select(Submission)
        .where(Submission.exam_id == exam_id)
        .options(*_submission_options())
        .order_by(Submission.started_at.desc())
    )
    submissions = list(db.execute(statement).scalars().unique().all())
    integrity_changed = False
    if current_user.role == UserRole.ADMIN:
        for submission in submissions:
            integrity_changed = verify_submission_integrity(db, submission) or integrity_changed
    if integrity_changed:
        db.commit()
    return submissions
