# Online Examination System

FastAPI backend with PostgreSQL, Redis, SQLAlchemy/Alembic, custom JWT auth, and a React/Vite frontend.

## Docker Services

Start PostgreSQL and Redis:

```powershell
docker compose up -d
```

## Backend

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





to run 


Terminal 1 — Start Docker
From project root:
cd "C:\Users\ELCOT\Desktop\exam portal\online-exam-system"
docker compose up -d
docker ps
You should see:
exam_postgresexam_redis

Terminal 2 — Start Backend
cd "C:\Users\ELCOT\Desktop\exam portal\online-exam-system\backend"
.\.venv\Scripts\Activate.ps1
alembic current
python run.py
Expected:
20260427_0006 (head)Application startup complete.
Backend:
http://localhost:8000
Swagger:
http://localhost:8000/docs

Terminal 3 — Start Frontend
cd "C:\Users\ELCOT\Desktop\exam portal\online-exam-system\frontend"
npm run dev
Open the link it gives, probably:
http://localhost:3000

Login credentials
Admin:
admin@example.comAdmin@123
Student:
student@example.comStudent@123
Student signup requires institutional email like:
jobrits.cs24@stellamaryscoe.edu.in

If backend says users table does not exist, run:
cd "C:\Users\ELCOT\Desktop\exam portal\online-exam-system\backend".\.venv\Scripts\Activate.ps1alembic upgrade headpython scripts/seed_sample_exam.pypython run.py
Start with Terminal 1 and tell me what you get after docker ps.