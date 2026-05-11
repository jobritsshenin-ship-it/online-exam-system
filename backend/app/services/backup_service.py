import gzip
import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import MetaData, create_engine, select

from app.core.config import settings


TABLES_TO_EXPORT = [
    "users",
    "exams",
    "questions",
    "question_options",
    "submissions",
    "submission_answers",
    "submission_events",
    "admin_activity_logs",
    "security_alerts",
]
SENSITIVE_USER_FIELDS = {"password", "password_hash"}


@dataclass(frozen=True)
class DatabaseBackup:
    content: bytes
    filename: str
    table_names: list[str]
    row_counts: dict[str, int]


def _json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def _serialize_row(table_name: str, row: dict[str, Any]) -> dict[str, Any]:
    serialized = {}
    for key, value in row.items():
        if table_name == "users" and key in SENSITIVE_USER_FIELDS:
            serialized[key] = "[REDACTED]"
        else:
            serialized[key] = _json_safe(value)
    return serialized


def generate_database_backup(database_url: str | None = None) -> DatabaseBackup:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"online_exam_backup_{timestamp}.json.gz"
    engine = create_engine(database_url or settings.database_url, pool_pre_ping=True)
    metadata = MetaData()

    try:
        metadata.reflect(bind=engine, only=TABLES_TO_EXPORT)
        backup_payload: dict[str, list[dict[str, Any]]] = {}
        row_counts: dict[str, int] = {}

        with engine.connect() as connection:
            for table_name in TABLES_TO_EXPORT:
                table = metadata.tables.get(table_name)
                if table is None:
                    raise RuntimeError(f"Required table is missing: {table_name}")

                statement = select(table)
                if "id" in table.c:
                    statement = statement.order_by(table.c.id)

                rows = [
                    _serialize_row(table_name, dict(row))
                    for row in connection.execute(statement).mappings().all()
                ]
                backup_payload[table_name] = rows
                row_counts[table_name] = len(rows)
    finally:
        engine.dispose()

    json_bytes = json.dumps(backup_payload, ensure_ascii=False, indent=2).encode("utf-8")
    return DatabaseBackup(
        content=gzip.compress(json_bytes),
        filename=filename,
        table_names=list(TABLES_TO_EXPORT),
        row_counts=row_counts,
    )


def write_database_backup(backup_dir: Path, database_url: str | None = None) -> tuple[Path, DatabaseBackup]:
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = generate_database_backup(database_url=database_url)
    backup_path = backup_dir / backup.filename
    backup_path.write_bytes(backup.content)
    return backup_path, backup
