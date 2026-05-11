import sys
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.backup_service import TABLES_TO_EXPORT, write_database_backup


def create_backup():
    return write_database_backup(BACKEND_ROOT / "backups")


def main() -> int:
    try:
        backup_path, backup = create_backup()
    except (RuntimeError, SQLAlchemyError, OSError) as exc:
        print(f"Backup failed: {exc}", file=sys.stderr)
        return 1

    print(f"Backup created: {backup_path}")
    print("Row counts:")
    for table_name in TABLES_TO_EXPORT:
        print(f"  {table_name}: {backup.row_counts.get(table_name, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
