from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AdminSummaryRead(BaseModel):
    total_exams: int
    published_exams: int
    draft_exams: int
    archived_exams: int
    total_students: int
    total_admins: int
    total_submissions: int
    average_score: float | None = None


class AdminActivityLogRead(BaseModel):
    id: int
    admin_id: int | None
    admin_email: str | None
    action: str
    entity_type: str | None
    entity_id: int | None
    details: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
