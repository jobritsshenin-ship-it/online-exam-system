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


class SecurityAlertRead(BaseModel):
    id: int
    severity: str
    alert_type: str
    title: str
    message: str
    entity_type: str | None
    entity_id: int | None
    metadata_json: str | None
    is_resolved: bool
    resolved_at: datetime | None
    resolved_by_admin_id: int | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StudentExamHistoryItemRead(BaseModel):
    submission_id: int
    exam_id: int
    exam_title: str
    exam_subject: str | None
    student_id: int
    student_name: str
    student_email: str
    register_number: str | None
    department: str | None
    year: str | None
    status: str
    score: int | None
    total_marks: int
    percentage: float | None
    pass_fail: str
    submitted_at: datetime | None
    started_at: datetime
    is_result_published: bool
    integrity_status: str
