from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import settings
from app.db.session import SessionLocal
from app.redis.client import check_redis_connection
from app.services.auth_service import ensure_first_admin


WORD_IMPORT_ROUTE_SUFFIX = "/questions/import-docx"


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


@app.middleware("http")
async def limit_request_body_size(request: Request, call_next):
    if request.url.path.endswith(WORD_IMPORT_ROUTE_SUFFIX):
        return await call_next(request)

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            body_size = int(content_length)
        except ValueError:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": "Request body is too large."},
            )

        if body_size > settings.max_request_body_size_bytes:
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={"detail": "Request body is too large."},
            )

    return await call_next(request)


app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/")
def root():
    return {
        "message": settings.app_name,
        "environment": settings.app_env,
        "docs_url": "/docs",
    }
