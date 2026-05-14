from __future__ import annotations

import csv
import logging
import os
import queue
import random
from pathlib import Path
from threading import Lock
from typing import Any

import gevent
from dotenv import load_dotenv
from locust import HttpUser, between, task
from locust.exception import StopUser


load_dotenv(Path(__file__).with_name(".env"))
load_dotenv()

logger = logging.getLogger("online_exam_load_test")

DEFAULT_STUDENTS_CSV = Path(__file__).with_name("students.csv")
REQUEST_PAUSE_SECONDS = (0.25, 1.25)
BASE_URL = (os.getenv("BASE_URL") or "").rstrip("/") or None

_student_queue: queue.Queue[dict[str, str]] | None = None
_student_queue_lock = Lock()


def resolve_students_csv() -> Path:
    raw_path = os.getenv("STUDENTS_CSV", str(DEFAULT_STUDENTS_CSV))
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path
    return Path.cwd() / path


def load_students() -> list[dict[str, str]]:
    path = resolve_students_csv()
    if not path.exists():
        raise RuntimeError(f"Students CSV not found: {path}")

    with path.open("r", newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        rows = [
            {key: (value or "").strip() for key, value in row.items()}
            for row in reader
            if (row.get("email") or "").strip() and (row.get("password") or "").strip()
        ]

    if not rows:
        raise RuntimeError(f"Students CSV has no usable rows: {path}")

    logger.info("Loaded %s student rows from %s", len(rows), path)
    return rows


def get_next_student() -> dict[str, str] | None:
    global _student_queue

    with _student_queue_lock:
        if _student_queue is None:
            _student_queue = queue.Queue()
            for row in load_students():
                _student_queue.put(row)

    try:
        return _student_queue.get_nowait()
    except queue.Empty:
        return None


def response_detail(response) -> str:
    try:
        payload: Any = response.json()
    except ValueError:
        return response.text.strip()

    if isinstance(payload, dict):
        detail = payload.get("detail", payload)
    else:
        detail = payload

    if isinstance(detail, list):
        return "; ".join(str(item) for item in detail)
    return str(detail)


def is_previously_used_attempt(message: str) -> bool:
    normalized = message.lower()
    return (
        "already submitted" in normalized
        or "cannot be reopened" in normalized
        or "already started or submitted" in normalized
        or "start this exam before" in normalized
    )


def sorted_questions(exam: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        exam.get("questions") or [],
        key=lambda question: (
            question.get("sort_order", 0),
            question.get("id", 0),
        ),
    )


def choose_option(question: dict[str, Any]) -> dict[str, Any] | None:
    options = [
        option
        for option in (question.get("options") or [])
        if option.get("id") is not None
    ]
    if not options:
        return None
    return random.choice(options)


class OnlineExamStudent(HttpUser):
    host = BASE_URL
    wait_time = between(1, 3)

    def on_start(self) -> None:
        if not self.host:
            logger.error("Set BASE_URL or pass --host before running Locust.")
            raise StopUser()

        try:
            self.student = get_next_student()
        except RuntimeError as exc:
            logger.error("%s", exc)
            raise StopUser() from exc

        self.token: str | None = None

        if not self.student:
            logger.warning("No unused student rows left. Stopping user.")
            raise StopUser()

    def auth_headers(self) -> dict[str, str]:
        if not self.token:
            raise StopUser()
        return {"Authorization": f"Bearer {self.token}"}

    def pause_between_actions(self) -> None:
        gevent.sleep(random.uniform(*REQUEST_PAUSE_SECONDS))

    def request_json(
        self,
        method: str,
        path: str,
        *,
        name: str,
        expected_statuses: set[int],
        graceful_attempt_reuse: bool = False,
        **kwargs: Any,
    ) -> Any:
        with self.client.request(
            method,
            path,
            name=name,
            catch_response=True,
            **kwargs,
        ) as response:
            if response.status_code in expected_statuses:
                try:
                    return response.json()
                except ValueError:
                    response.failure("Response was not valid JSON.")
                    raise StopUser()

            detail = response_detail(response)
            if graceful_attempt_reuse and is_previously_used_attempt(detail):
                response.success()
                logger.info(
                    "Stopping %s because the attempt is already closed: %s",
                    self.student.get("email"),
                    detail,
                )
                raise StopUser()

            response.failure(f"{response.status_code}: {detail}")
            logger.error(
                "%s failed for %s: %s",
                name,
                self.student.get("email"),
                detail,
            )
            raise StopUser()

    def login(self) -> None:
        payload = {
            "email": self.student["email"],
            "password": self.student["password"],
        }
        data = self.request_json(
            "POST",
            "/auth/login",
            name="POST /auth/login",
            expected_statuses={200},
            json=payload,
        )
        self.token = data.get("access_token")
        if not self.token:
            logger.error("Login response did not include an access token for %s", self.student["email"])
            raise StopUser()

    def find_exam(self) -> dict[str, Any]:
        exams = self.request_json(
            "GET",
            "/exams",
            name="GET /exams",
            expected_statuses={200},
            headers=self.auth_headers(),
        )

        exam_id = (os.getenv("LOAD_TEST_EXAM_ID") or "").strip()
        exam_title = (os.getenv("LOAD_TEST_EXAM_TITLE") or "").strip()

        if exam_id:
            for exam in exams:
                if str(exam.get("id")) == exam_id:
                    return exam
            logger.error("Exam id %s was not found for %s", exam_id, self.student["email"])
            raise StopUser()

        if exam_title:
            normalized_title = exam_title.lower()
            for exam in exams:
                if (exam.get("title") or "").strip().lower() == normalized_title:
                    return exam
            logger.error("Exam title %r was not found for %s", exam_title, self.student["email"])
            raise StopUser()

        logger.error("Set LOAD_TEST_EXAM_ID or LOAD_TEST_EXAM_TITLE before running the test.")
        raise StopUser()

    def load_exam_details(self, exam_id: int) -> dict[str, Any]:
        exam = self.request_json(
            "GET",
            f"/exams/{exam_id}",
            name="GET /exams/{exam_id}",
            expected_statuses={200},
            headers=self.auth_headers(),
        )
        if not sorted_questions(exam):
            logger.error("Exam %s has no questions visible to the student.", exam_id)
            raise StopUser()
        return exam

    def start_exam(self, exam_id: int) -> None:
        self.request_json(
            "POST",
            f"/exams/{exam_id}/start",
            name="POST /exams/{exam_id}/start",
            expected_statuses={200, 201},
            graceful_attempt_reuse=True,
            headers=self.auth_headers(),
        )

    def save_answers(self, exam: dict[str, Any]) -> list[dict[str, int]]:
        answers: list[dict[str, int]] = []
        for question in sorted_questions(exam):
            option = choose_option(question)
            if option is None:
                logger.error(
                    "Question %s has no answer options for %s.",
                    question.get("id"),
                    self.student["email"],
                )
                raise StopUser()

            answer = {
                "question_id": int(question["id"]),
                "selected_option_id": int(option["id"]),
            }
            self.request_json(
                "POST",
                f"/exams/{exam['id']}/answers",
                name="POST /exams/{exam_id}/answers",
                expected_statuses={200},
                graceful_attempt_reuse=True,
                headers=self.auth_headers(),
                json={
                    **answer,
                    "is_marked_for_review": False,
                },
            )
            answers.append(answer)
            self.pause_between_actions()

        return answers

    def submit_exam(self, exam_id: int, answers: list[dict[str, int]]) -> None:
        self.request_json(
            "POST",
            f"/exams/{exam_id}/submit",
            name="POST /exams/{exam_id}/submit",
            expected_statuses={200},
            graceful_attempt_reuse=True,
            headers=self.auth_headers(),
            json={"answers": answers},
        )

    @task
    def complete_exam_once(self) -> None:
        self.login()
        self.pause_between_actions()

        exam_summary = self.find_exam()
        self.pause_between_actions()

        exam = self.load_exam_details(int(exam_summary["id"]))
        self.pause_between_actions()

        self.start_exam(int(exam["id"]))
        self.pause_between_actions()

        answers = self.save_answers(exam)
        self.pause_between_actions()

        self.submit_exam(int(exam["id"]), answers)
        logger.info("Submitted exam %s for %s", exam["id"], self.student["email"])
        raise StopUser()
