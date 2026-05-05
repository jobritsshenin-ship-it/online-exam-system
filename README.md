# Online Examination System

A full-stack online examination portal with role-based administration, controlled student access, exam authoring, imports, strict exam-mode safeguards, and delayed result publication.

## Tech Stack

- Frontend: React/Vite
- Backend: FastAPI
- Database: PostgreSQL
- Cache/session support: Redis
- ORM and migrations: SQLAlchemy/Alembic
- Auth: JWT auth

## Features

- Admin and student roles
- Student signup with institutional email
- Admin user management
- Exam builder
- CSV import
- Word `.docx` import
- Strict anti-cheat auto-submit
- Result publish/unpublish
- HMAC-SHA256 result integrity checks for admin result data
- Admin security alerts for detected result tampering
- Archive/delete exam safety
- Admin activity log

## Local Setup

Start PostgreSQL and Redis:

```powershell
docker compose up -d
```

Set up and run the backend:

```powershell
cd online-exam-system
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head
python run.py
```

Set up and run the frontend:

```powershell
cd online-exam-system
cd frontend
npm install
npm run dev
```

The backend API is served under `/api/v1`.

## Environment Variables

Create `backend/.env` from `backend/.env.example` and configure:

- `APP_ENV`
- `BACKEND_CORS_ORIGINS`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET_KEY`
- `INTEGRITY_SECRET_KEY`
- `FIRST_SUPERUSER_EMAIL`
- `FIRST_SUPERUSER_PASSWORD`

Use strong `JWT_SECRET_KEY` and `INTEGRITY_SECRET_KEY` values for production. `INTEGRITY_SECRET_KEY` is only used for result integrity HMACs and must not reuse the JWT secret. Do not commit `.env`.

## Result Integrity

Submitted result-critical data is sealed with HMAC-SHA256 using `INTEGRITY_SECRET_KEY`. This protects against silent changes to submission score, status, submit timestamps, selected answers, correctness, awarded marks, marked-for-review state, and the correct option used to verify each answer.

This is tamper-evident integrity protection, not encryption. If someone changes database rows but does not control the backend environment secret, admin result views will detect a mismatch, mark the submission as `tampered`, and create a critical security alert. If an attacker controls both the database and backend environment secret, app-level HMACs cannot fully protect the data.

Old submissions without an integrity hash remain `unverified`; they are not automatically marked as tampered.

## Local Database Backup

Create a compressed JSON backup of important tables:

```powershell
cd backend
python scripts/backup_database.py
```

Backups are written to `backend/backups/` as `online_exam_backup_YYYYMMDD_HHMMSS.json.gz`. The script exports users, exams, questions, options, submissions, submission answers, submission events, admin activity logs, and security alerts. User password fields are redacted in the JSON backup.

## Default Local Demo Credentials

- Admin: `admin@example.com` / `Admin@123`
- Student: `student@example.com` / `Student@123` if the seed script is run

Seed sample data:

```powershell
cd backend
python scripts/seed_sample_exam.py
```

## Deployment Plan

- Frontend: Vercel
- Backend: Render
- PostgreSQL: Neon
- Redis: Upstash

## Production Notes

- Use a strong JWT secret and rotate it if it is ever exposed.
- Use a separate strong integrity secret and rotate it carefully because existing result seals depend on it.
- Do not commit `.env` or production credentials.
- Configure CORS to only allow the deployed frontend origin.
- Run `alembic upgrade head` before serving a new backend release.
- Render free tier may sleep, which can delay first requests.
- Render's local filesystem is ephemeral, so local backup files created on Render are not durable.
- Use paid hosting for real institutional exams.
- Future production backup work should write encrypted backups to durable cloud storage instead of relying on Render's local disk.

## Known Limitations

- Browser-based anti-cheat cannot fully lock the operating system.
- For high-stakes exams, use a lockdown browser, kiosk mode, or controlled lab environment.
