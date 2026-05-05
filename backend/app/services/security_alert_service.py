import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.security_alert import SecurityAlert
from app.models.user import User


def _serialize_metadata(metadata: Any) -> str | None:
    if metadata is None:
        return None
    if isinstance(metadata, str):
        return metadata
    return json.dumps(metadata, sort_keys=True, default=str)


def create_security_alert(
    db: Session,
    severity: str,
    alert_type: str,
    title: str,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    metadata: Any = None,
) -> SecurityAlert:
    alert = SecurityAlert(
        severity=severity,
        alert_type=alert_type,
        title=title,
        message=message,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata_json=_serialize_metadata(metadata),
    )
    db.add(alert)
    db.flush()
    return alert


def create_security_alert_once(
    db: Session,
    severity: str,
    alert_type: str,
    title: str,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    metadata: Any = None,
) -> SecurityAlert | None:
    statement = select(SecurityAlert).where(
        SecurityAlert.alert_type == alert_type,
        SecurityAlert.entity_type == entity_type,
        SecurityAlert.entity_id == entity_id,
    )
    existing_alert = db.execute(statement).scalars().first()
    if existing_alert:
        return None

    return create_security_alert(
        db=db,
        severity=severity,
        alert_type=alert_type,
        title=title,
        message=message,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata=metadata,
    )


def list_security_alerts(
    db: Session,
    limit: int = 50,
    offset: int = 0,
    severity: str | None = None,
    is_resolved: bool | None = None,
) -> list[SecurityAlert]:
    statement = select(SecurityAlert)
    if severity:
        statement = statement.where(SecurityAlert.severity == severity)
    if is_resolved is not None:
        statement = statement.where(SecurityAlert.is_resolved.is_(is_resolved))

    statement = statement.order_by(SecurityAlert.created_at.desc(), SecurityAlert.id.desc()).offset(offset).limit(limit)
    return list(db.execute(statement).scalars().all())


def resolve_security_alert(db: Session, alert_id: int, admin: User) -> SecurityAlert:
    alert = db.get(SecurityAlert, alert_id)
    if not alert:
        raise LookupError("Security alert not found.")

    alert.is_resolved = True
    alert.resolved_at = datetime.now(timezone.utc)
    alert.resolved_by_admin_id = admin.id
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert
