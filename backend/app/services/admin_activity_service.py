import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_activity import AdminActivityLog
from app.models.user import User


def _serialize_details(details: Any) -> str | None:
    if details is None:
        return None
    if isinstance(details, str):
        return details
    return json.dumps(details, sort_keys=True, default=str)


def log_admin_activity(
    db: Session,
    admin: User | None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    details: Any = None,
) -> AdminActivityLog:
    log = AdminActivityLog(
        admin_id=admin.id if admin else None,
        admin_email=admin.email if admin else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=_serialize_details(details),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def list_admin_activity(
    db: Session,
    limit: int = 50,
    offset: int = 0,
    action: str | None = None,
    entity_type: str | None = None,
) -> list[AdminActivityLog]:
    statement = select(AdminActivityLog)
    if action:
        statement = statement.where(AdminActivityLog.action == action)
    if entity_type:
        statement = statement.where(AdminActivityLog.entity_type == entity_type)

    statement = statement.order_by(AdminActivityLog.created_at.desc(), AdminActivityLog.id.desc()).offset(offset).limit(limit)
    return list(db.execute(statement).scalars().all())
