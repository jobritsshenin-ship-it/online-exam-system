# Online Exam Load Tests

These utilities create dummy student accounts and run API-level Locust traffic against a published test exam. Use a dedicated test exam and start with small user counts.

## Safety Warnings

- Do not run heavy load tests during real exams.
- Start small and increase gradually.
- Use a published test exam, not a live student exam.
- `students.csv` contains passwords and must not be committed.
- These tools use existing APIs only; they do not change backend APIs or the database schema.

## 1. Create A Virtual Environment

From Windows PowerShell:

```powershell
cd "C:\Users\ELCOT\Desktop\exam portal\online-exam-system\load_tests"
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If `py -3.12` is not available, use:

```powershell
python -m venv .venv
```

## 2. Create Dummy Students

Set the environment variables. Do not paste real admin credentials into source files.

```powershell
$env:BASE_URL = "https://online-exam-backend-y0md.onrender.com/api/v1"
$env:ADMIN_EMAIL = "your-admin-email@example.com"
$env:ADMIN_PASSWORD = "your-admin-password"
$env:STUDENT_COUNT = "25"
$env:OUTPUT_CSV = ".\students.csv"

python .\create_load_test_students.py
```

The generated students use:

- Email: `loadtest001@stellamaryscoe.edu.in`, `loadtest002@stellamaryscoe.edu.in`, etc.
- Password: `LoadTest@123`
- Register number: `963500000001`, `963500000002`, etc.
- Department: `CSE`
- Class name: `Load Test`

If a student already exists, the script skips that API error and still records the expected credentials in the CSV.

## 3. Run Locust

Use either a test exam title or a test exam id.

```powershell
$env:BASE_URL = "https://online-exam-backend-y0md.onrender.com/api/v1"
$env:STUDENTS_CSV = ".\students.csv"
$env:LOAD_TEST_EXAM_TITLE = "Your Published Load Test Exam Title"

locust -f .\locustfile.py
```

Or use an exam id:

```powershell
Remove-Item Env:LOAD_TEST_EXAM_TITLE -ErrorAction SilentlyContinue
$env:LOAD_TEST_EXAM_ID = "123"

locust -f .\locustfile.py
```

Open the Locust dashboard:

```text
http://localhost:8089
```

In the dashboard, keep the host as:

```text
https://online-exam-backend-y0md.onrender.com/api/v1
```

## Suggested Test Rounds

Run one round at a time and watch Render/PostgreSQL/Redis health while the test runs.

```text
10 users, spawn rate 2
25 users, spawn rate 5
50 users, spawn rate 5
100 users, spawn rate 10
```

For headless runs:

```powershell
locust -f .\locustfile.py --headless -u 10 -r 2 --run-time 2m
```

## What The Locust User Does

Each simulated user:

1. Takes one unique row from `students.csv`.
2. Logs in with `POST /auth/login`.
3. Loads exams with `GET /exams`.
4. Finds the configured exam by `LOAD_TEST_EXAM_TITLE` or `LOAD_TEST_EXAM_ID`.
5. Loads exam details with `GET /exams/{exam_id}`.
6. Starts the exam with `POST /exams/{exam_id}/start`.
7. Chooses one option per question.
8. Saves answers with `POST /exams/{exam_id}/answers`.
9. Submits with `POST /exams/{exam_id}/submit`.

The basic load test does not send proctoring violations. If a student has already submitted or an attempt cannot be reopened, that simulated user stops cleanly.
