from datetime import datetime
from typing import Literal
from typing import List

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.utils.enums import QuestionType, SubmissionStatus


class ExamBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    subject: str | None = Field(default=None, max_length=255)
    description: str | None = None
    instructions: str | None = None
    duration_minutes: int = Field(ge=1)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_published: bool = False
    is_archived: bool = False
    is_result_published: bool = False


class ExamCreate(ExamBase):
    pass


class ExamUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    subject: str | None = Field(default=None, max_length=255)
    description: str | None = None
    instructions: str | None = None
    duration_minutes: int | None = Field(default=None, ge=1)
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class ExamPublish(BaseModel):
    is_published: bool


class ExamArchive(BaseModel):
    is_archived: bool


class ExamResultPublish(BaseModel):
    is_result_published: bool


class QuestionOptionCreate(BaseModel):
    id: int | None = None
    text: str = Field(min_length=1)
    is_correct: bool = False
    sort_order: int = 0

    @field_validator("text")
    @classmethod
    def strip_option_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Option text cannot be blank.")
        return stripped


class QuestionOptionRead(BaseModel):
    id: int
    text: str
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class QuestionOptionAdminRead(QuestionOptionRead):
    is_correct: bool


class QuestionCreate(BaseModel):
    prompt: str = Field(min_length=1)
    explanation: str | None = None
    question_type: QuestionType = QuestionType.MCQ
    marks: int = Field(default=1, ge=1)
    sort_order: int = 0
    options: List[QuestionOptionCreate] = Field(default_factory=list)

    @field_validator("prompt")
    @classmethod
    def strip_prompt(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Question prompt cannot be blank.")
        return stripped

    @field_validator("explanation")
    @classmethod
    def strip_explanation(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def validate_mcq_options(self):
        if self.question_type != QuestionType.MCQ:
            raise ValueError("Only multiple-choice questions are supported right now.")
        if len(self.options) < 2:
            raise ValueError("A multiple-choice question needs at least two non-empty options.")
        correct_count = sum(1 for option in self.options if option.is_correct)
        if correct_count != 1:
            raise ValueError("A multiple-choice question needs exactly one correct option.")
        return self


class QuestionBulkCreate(BaseModel):
    questions: List[QuestionCreate] = Field(min_length=1)


class QuestionImportBlockResult(BaseModel):
    block_number: int
    question: str | None = None
    valid: bool
    errors: List[str] = Field(default_factory=list)


class QuestionImportResult(BaseModel):
    valid_count: int
    invalid_count: int
    created_count: int
    blocks: List[QuestionImportBlockResult] = Field(default_factory=list)


class QuestionRead(BaseModel):
    id: int
    exam_id: int
    prompt: str
    explanation: str | None
    question_type: QuestionType
    marks: int
    sort_order: int
    options: List[QuestionOptionRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class QuestionAdminRead(QuestionRead):
    options: List[QuestionOptionAdminRead] = Field(default_factory=list)


class ExamRead(ExamBase):
    id: int
    created_by_id: int
    created_at: datetime
    updated_at: datetime
    questions: List[QuestionRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ExamAdminRead(ExamRead):
    questions: List[QuestionAdminRead] = Field(default_factory=list)


class SubmissionAnswerCreate(BaseModel):
    question_id: int
    selected_option_id: int | None


class SubmissionCreate(BaseModel):
    answers: List[SubmissionAnswerCreate] = Field(default_factory=list)


class AutoSubmitRequest(SubmissionCreate):
    reason: Literal[
        "tab_hidden",
        "window_blur",
        "fullscreen_exit",
        "page_unload",
        "route_leave",
        "logout_during_exam",
        "manual_security_lock",
        "reopen_attempt",
        "timer_expired",
    ] = "manual_security_lock"

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Auto-submit reason is required.")
        return stripped


class SavedAnswerRequest(BaseModel):
    question_id: int
    selected_option_id: int | None = None
    is_marked_for_review: bool = False


class SubmissionAnswerRead(BaseModel):
    id: int
    question_id: int
    question_prompt: str
    selected_option_id: int | None
    selected_option_text: str | None
    correct_option_id: int | None
    correct_option_text: str | None
    is_correct: bool
    marks_awarded: int
    is_marked_for_review: bool

    model_config = ConfigDict(from_attributes=True)


class StudentSubmissionAnswerRead(BaseModel):
    id: int
    question_id: int
    question_prompt: str
    selected_option_id: int | None
    selected_option_text: str | None
    is_marked_for_review: bool

    model_config = ConfigDict(from_attributes=True)


class SubmissionEventCreate(BaseModel):
    event_type: str = Field(min_length=1, max_length=80)
    details: str | None = Field(default=None, max_length=500)
    severity: Literal["low", "medium", "high", "critical"] = "low"
    metadata_json: str | None = Field(default=None, max_length=2000)


class SubmissionEventRead(BaseModel):
    id: int
    event_type: str
    details: str | None
    severity: str
    metadata_json: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SubmissionRead(BaseModel):
    id: int
    exam_id: int
    student_id: int
    student_email: str
    student_full_name: str
    student_register_number: str | None
    student_department: str | None
    student_batch: str | None
    student_class_name: str | None
    status: SubmissionStatus
    score: int | None
    started_at: datetime
    submitted_at: datetime | None
    integrity_status: str
    integrity_checked_at: datetime | None
    integrity_sealed_at: datetime | None
    cheat_event_count: int
    answers: List[SubmissionAnswerRead] = Field(default_factory=list)
    events: List[SubmissionEventRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class StudentSubmissionRead(BaseModel):
    id: int
    exam_id: int
    student_id: int
    status: SubmissionStatus
    score: int | None = None
    started_at: datetime
    submitted_at: datetime | None
    is_result_published: bool
    result_message: str
    answers: List[StudentSubmissionAnswerRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
