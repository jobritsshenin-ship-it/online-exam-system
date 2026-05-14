from __future__ import annotations

import csv
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv


load_dotenv(Path(__file__).with_name(".env"))
load_dotenv()

DEFAULT_STUDENT_PASSWORD = "LoadTest@123"
DEFAULT_OUTPUT_CSV = Path(__file__).with_name("students.csv")
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "30"))
MAX_REGISTER_SEQUENCE = 99_999_999


@dataclass
class StudentRow:
    email: str
    password: str
    register_number: str
    full_name: str


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value or not value.strip():
        raise SystemExit(f"Missing required environment variable: {name}")
    return value.strip()


def normalize_base_url(value: str) -> str:
    return value.strip().rstrip("/")


def parse_student_count() -> int:
    raw_value = os.getenv("STUDENT_COUNT", "10").strip()
    try:
        count = int(raw_value)
    except ValueError as exc:
        raise SystemExit("STUDENT_COUNT must be a positive integer.") from exc

    if count < 1:
        raise SystemExit("STUDENT_COUNT must be at least 1.")

    if count > MAX_REGISTER_SEQUENCE:
        raise SystemExit(f"STUDENT_COUNT must be {MAX_REGISTER_SEQUENCE} or lower.")

    return count


def extract_detail(response: requests.Response) -> str:
    try:
        payload: Any = response.json()
    except ValueError:
        return response.text.strip()

    detail = payload.get("detail") if isinstance(payload, dict) else payload
    if isinstance(detail, list):
        return "; ".join(str(item) for item in detail)
    return str(detail)


def is_duplicate_error(message: str) -> bool:
    normalized = message.lower()
    return (
        "already exists" in normalized
        or "already belongs" in normalized
        or "duplicate" in normalized
    )


def login_admin(session: requests.Session, base_url: str, email: str, password: str) -> str:
    response = session.post(
        f"{base_url}/auth/login",
        json={"email": email, "password": password},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise SystemExit(f"Admin login failed ({response.status_code}): {extract_detail(response)}")

    token = response.json().get("access_token")
    if not token:
        raise SystemExit("Admin login response did not include an access_token.")
    return token


def build_student(index: int) -> tuple[dict[str, Any], StudentRow]:
    full_name = f"LOAD TEST STUDENT {index:03d}"
    email = f"loadtest{index:03d}@stellamaryscoe.edu.in"
    register_number = f"9635{index:08d}"
    password = os.getenv("LOAD_TEST_STUDENT_PASSWORD", DEFAULT_STUDENT_PASSWORD)

    payload = {
        "full_name": full_name,
        "email": email,
        "password": password,
        "role": "student",
        "register_number": register_number,
        "department": "CSE",
        "batch": "",
        "class_name": "Load Test",
        "is_active": True,
        "is_superuser": False,
    }
    row = StudentRow(
        email=email,
        password=password,
        register_number=register_number,
        full_name=full_name,
    )
    return payload, row


def create_student(
    session: requests.Session,
    base_url: str,
    token: str,
    payload: dict[str, Any],
) -> tuple[str, str]:
    response = session.post(
        f"{base_url}/auth/users",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )

    if response.status_code in (200, 201):
        return "created", ""

    detail = extract_detail(response)
    if response.status_code == 400 and is_duplicate_error(detail):
        return "skipped", detail

    return "failed", f"{response.status_code}: {detail}"


def write_students_csv(path: Path, rows: list[StudentRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=["email", "password", "register_number", "full_name"],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "email": row.email,
                    "password": row.password,
                    "register_number": row.register_number,
                    "full_name": row.full_name,
                }
            )


def main() -> int:
    base_url = normalize_base_url(required_env("BASE_URL"))
    admin_email = required_env("ADMIN_EMAIL")
    admin_password = required_env("ADMIN_PASSWORD")
    student_count = parse_student_count()
    output_csv = Path(os.getenv("OUTPUT_CSV", str(DEFAULT_OUTPUT_CSV))).expanduser()

    session = requests.Session()
    token = login_admin(session, base_url, admin_email, admin_password)

    created_count = 0
    skipped_count = 0
    failed_count = 0
    csv_rows: list[StudentRow] = []

    for index in range(1, student_count + 1):
        payload, row = build_student(index)
        status, detail = create_student(session, base_url, token, payload)

        if status == "created":
            created_count += 1
            csv_rows.append(row)
            print(f"created {row.email} ({row.register_number})")
        elif status == "skipped":
            skipped_count += 1
            csv_rows.append(row)
            print(f"skipped {row.email} ({row.register_number}): {detail}")
        else:
            failed_count += 1
            print(f"failed {row.email} ({row.register_number}): {detail}")

    write_students_csv(output_csv, csv_rows)

    print()
    print("Load test student creation summary")
    print(f"created count: {created_count}")
    print(f"skipped count: {skipped_count}")
    print(f"failed count: {failed_count}")
    print(f"output CSV path: {output_csv.resolve()}")

    return 1 if failed_count else 0


if __name__ == "__main__":
    sys.exit(main())
