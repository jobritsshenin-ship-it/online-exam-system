import gzip
import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import MetaData, create_engine, select
from sqlalchemy.exc import SQLAlchemyError

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

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


def create_backup() -> tuple[Path, dict[str, int]]:
    backup_dir = BACKEND_ROOT / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"online_exam_backup_{timestamp}.json.gz"

    engine = create_engine(settings.database_url, pool_pre_ping=True)
    metadata = MetaData()
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

    with gzip.open(backup_path, "wt", encoding="utf-8") as backup_file:
        json.dump(backup_payload, backup_file, ensure_ascii=False, indent=2)

    return backup_path, row_counts


def main() -> int:
    try:
        backup_path, row_counts = create_backup()
    except (RuntimeError, SQLAlchemyError, OSError) as exc:
        print(f"Backup failed: {exc}", file=sys.stderr)
        return 1

    print(f"Backup created: {backup_path}")
    print("Row counts:")
    for table_name in TABLES_TO_EXPORT:
        print(f"  {table_name}: {row_counts.get(table_name, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
