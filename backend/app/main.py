from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.session import SessionLocal
from app.redis.client import check_redis_connection
from app.services.auth_service import ensure_first_admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        ensure_first_admin(
            db=db,
            email=settings.first_superuser_email,
            password=settings.first_superuser_password,
            full_name=settings.first_superuser_full_name,
        )
    finally:
        db.close()

    app.state.redis_ready = check_redis_connection()
    yield


app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/")
def root():
    return {
        "message": settings.app_name,
        "environment": settings.app_env,
        "docs_url": "/docs",
    }
