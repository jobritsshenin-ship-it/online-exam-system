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
- `FIRST_SUPERUSER_EMAIL`
- `FIRST_SUPERUSER_PASSWORD`

Use a strong `JWT_SECRET_KEY` for production. Do not commit `.env`.

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
- Do not commit `.env` or production credentials.
- Configure CORS to only allow the deployed frontend origin.
- Run `alembic upgrade head` before serving a new backend release.
- Render free tier may sleep, which can delay first requests.
- Use paid hosting for real institutional exams.

## Known Limitations

- Browser-based anti-cheat cannot fully lock the operating system.
- For high-stakes exams, use a lockdown browser, kiosk mode, or controlled lab environment.
