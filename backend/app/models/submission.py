from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.utils.enums import SubmissionStatus


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("exam_id", "student_id", name="uq_submission_exam_student"),
        CheckConstraint(
            "integrity_status IN ('unverified', 'verified', 'tampered')",
            name="ck_submissions_integrity_status",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus, name="submission_status"),
        nullable=False,
        default=SubmissionStatus.IN_PROGRESS,
        index=True,
    )
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    integrity_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    integrity_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="unverified",
        index=True,
    )
    integrity_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    integrity_sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    exam: Mapped["Exam"] = relationship("Exam")
    student: Mapped["User"] = relationship("User")
    answers: Mapped[list["SubmissionAnswer"]] = relationship(
        "SubmissionAnswer",
        back_populates="submission",
        cascade="all, delete-orphan",
    )
    events: Mapped[list["SubmissionEvent"]] = relationship(
        "SubmissionEvent",
        back_populates="submission",
        cascade="all, delete-orphan",
    )

    @property
    def student_email(self) -> str:
        return self.student.email

    @property
    def student_full_name(self) -> str:
        return self.student.full_name

    @property
    def student_register_number(self) -> str | None:
        return self.student.register_number

    @property
    def student_department(self) -> str | None:
        return self.student.department

    @property
    def student_batch(self) -> str | None:
        return self.student.batch

    @property
    def student_class_name(self) -> str | None:
        return self.student.class_name

    @property
    def cheat_event_count(self) -> int:
        return len(self.events)


class SubmissionAnswer(Base):
    __tablename__ = "submission_answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("submissions.id"),
        nullable=False,
        index=True,
    )
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), nullable=False, index=True)
    selected_option_id: Mapped[int | None] = mapped_column(
        ForeignKey("question_options.id"),
        nullable=True,
        index=True,
    )
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    marks_awarded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_marked_for_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    submission: Mapped[Submission] = relationship("Submission", back_populates="answers")
    question: Mapped["Question"] = relationship("Question")
    selected_option: Mapped["QuestionOption"] = relationship("QuestionOption")

    @property
    def question_prompt(self) -> str:
        return self.question.prompt

    @property
    def selected_option_text(self) -> str | None:
        return self.selected_option.text if self.selected_option else None

    @property
    def correct_option_id(self) -> int | None:
        correct_option = next((option for option in self.question.options if option.is_correct), None)
        return correct_option.id if correct_option else None

    @property
    def correct_option_text(self) -> str | None:
        correct_option = next((option for option in self.question.options if option.is_correct), None)
        return correct_option.text if correct_option else None


class SubmissionEvent(Base):
    __tablename__ = "submission_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("submissions.id"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="low")
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    submission: Mapped[Submission] = relationship("Submission", back_populates="events")
