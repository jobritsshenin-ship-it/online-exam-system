from pydantic import BaseModel


class AdminSummaryRead(BaseModel):
    total_exams: int
    published_exams: int
    draft_exams: int
    archived_exams: int
    total_students: int
    total_admins: int
    total_submissions: int
    average_score: float | None = None
