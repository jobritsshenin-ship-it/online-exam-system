# Online Examination System

FastAPI backend with PostgreSQL, Redis, SQLAlchemy/Alembic, custom JWT auth, and a React/Vite frontend.

## Docker Services

Start PostgreSQL and Redis:

```powershell
docker compose up -d
```

## Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head
python run.py
```

The backend API runs under `/api/v1`.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

## Seed Data

```powershell
cd backend
python scripts/seed_sample_exam.py
```

Default credentials:

- Admin: `admin@example.com` / `Admin@123`
- Student: `student@example.com` / `Student@123` if the seed script is run
