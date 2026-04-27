import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.exam import Exam, Question, QuestionOption
from app.schemas.user import UserCreate
from app.services.auth_service import create_user, ensure_first_admin, get_user_by_email
from app.utils.enums import QuestionType, UserRole


SAMPLE_EXAM_TITLE = "Python Basics Sample Exam"
SAMPLE_STUDENT_EMAIL = "student@example.com"
SAMPLE_STUDENT_PASSWORD = "Student@123"
SAMPLE_STUDENT_PROFILE = {
    "register_number": "STU-001",
    "department": "Computer Science",
    "batch": "2026",
    "class_name": "BSc CS A",
}


def seed_sample_exam() -> None:
    db = SessionLocal()
    try:
        admin = ensure_first_admin(
            db=db,
            email=settings.first_superuser_email,
            password=settings.first_superuser_password,
            full_name=settings.first_superuser_full_name,
        )
        admin = get_user_by_email(db, admin.email)

        student = get_user_by_email(db, SAMPLE_STUDENT_EMAIL)
        if student:
            for field, value in SAMPLE_STUDENT_PROFILE.items():
                setattr(student, field, value)
            db.commit()
            print(f"Sample student already exists: {SAMPLE_STUDENT_EMAIL}")
        else:
            create_user(
                db,
                UserCreate(
                    email=SAMPLE_STUDENT_EMAIL,
                    full_name="Sample Student",
                    password=SAMPLE_STUDENT_PASSWORD,
                    role=UserRole.STUDENT,
                    **SAMPLE_STUDENT_PROFILE,
                ),
            )
            print(f"Created sample student: {SAMPLE_STUDENT_EMAIL}")

        existing_exam = db.query(Exam).filter(Exam.title == SAMPLE_EXAM_TITLE).first()
        if existing_exam:
            print(f"Sample exam already exists with id={existing_exam.id}")
            return

        exam = Exam(
            title=SAMPLE_EXAM_TITLE,
            description="A short published demo exam for validating the exam workflow.",
            duration_minutes=30,
            is_published=True,
            created_by_id=admin.id,
        )

        exam.questions = [
            Question(
                prompt="Which keyword defines a function in Python?",
                question_type=QuestionType.MCQ,
                marks=1,
                sort_order=1,
                options=[
                    QuestionOption(text="func", is_correct=False, sort_order=1),
                    QuestionOption(text="def", is_correct=True, sort_order=2),
                    QuestionOption(text="function", is_correct=False, sort_order=3),
                    QuestionOption(text="lambda", is_correct=False, sort_order=4),
                ],
            ),
            Question(
                prompt="Which built-in type stores key-value pairs?",
                question_type=QuestionType.MCQ,
                marks=1,
                sort_order=2,
                options=[
                    QuestionOption(text="list", is_correct=False, sort_order=1),
                    QuestionOption(text="tuple", is_correct=False, sort_order=2),
                    QuestionOption(text="dict", is_correct=True, sort_order=3),
                    QuestionOption(text="set", is_correct=False, sort_order=4),
                ],
            ),
            Question(
                prompt="What is the result of len([10, 20, 30])?",
                question_type=QuestionType.MCQ,
                marks=1,
                sort_order=3,
                options=[
                    QuestionOption(text="2", is_correct=False, sort_order=1),
                    QuestionOption(text="3", is_correct=True, sort_order=2),
                    QuestionOption(text="30", is_correct=False, sort_order=3),
                    QuestionOption(text="Error", is_correct=False, sort_order=4),
                ],
            ),
        ]

        db.add(exam)
        db.commit()
        db.refresh(exam)
        print(f"Created sample exam id={exam.id}: {exam.title}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_sample_exam()
