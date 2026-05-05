from functools import lru_cache
from typing import Annotated, List

from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


WEAK_JWT_SECRET_VALUES = {
    "change-this-secret-key",
    "secret",
    "password",
    "test",
    "dev-secret",
}
JWT_SECRET_PRODUCTION_ERROR = "JWT_SECRET_KEY must be set to a strong secret in production."
WEAK_INTEGRITY_SECRET_VALUES = {
    "secret",
    "test",
    "change-this",
    "dev-secret",
    "integrity-secret",
    "change-this-integrity-secret-in-production",
}
INTEGRITY_SECRET_PRODUCTION_ERROR = "INTEGRITY_SECRET_KEY must be set to a strong secret in production."


class Settings(BaseSettings):
    app_name: str = "Online Examination System API"
    app_env: str = "development"
    debug: bool = True
    api_v1_prefix: str = "/api/v1"

    backend_cors_origins: Annotated[List[str], NoDecode] = ["http://localhost:3000"]

    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/online_exam_db"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret_key: str = "change-this-secret-key"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    integrity_secret_key: str = "change-this-integrity-secret-in-production"
    max_request_body_size_bytes: int = 5 * 1024 * 1024

    first_superuser_email: str = "admin@example.com"
    first_superuser_password: str = "Admin@123"
    first_superuser_full_name: str = "System Administrator"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        # Prefer this project's .env over unrelated machine-level variables.
        return init_settings, dotenv_settings, env_settings, file_secret_settings

    @field_validator("backend_cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if isinstance(value, str):
            if not value.strip():
                return []
            return [origin.strip() for origin in value.split(",")]
        return value

    @field_validator("jwt_secret_key")
    @classmethod
    def validate_jwt_secret_key(cls, value: str, info: ValidationInfo) -> str:
        app_env = str(info.data.get("app_env", "development")).strip().lower()
        if app_env not in {"production", "prod"}:
            return value

        secret = (value or "").strip()
        if secret.lower() in WEAK_JWT_SECRET_VALUES or len(secret) < 32:
            raise ValueError(JWT_SECRET_PRODUCTION_ERROR)

        return value

    @field_validator("integrity_secret_key")
    @classmethod
    def validate_integrity_secret_key(cls, value: str, info: ValidationInfo) -> str:
        app_env = str(info.data.get("app_env", "development")).strip().lower()
        if app_env not in {"production", "prod"}:
            return value

        secret = (value or "").strip()
        jwt_secret = str(info.data.get("jwt_secret_key", "")).strip()
        normalized_secret = secret.lower()
        if (
            not secret
            or len(secret) < 32
            or normalized_secret in WEAK_INTEGRITY_SECRET_VALUES
            or normalized_secret.startswith("change-this")
            or (jwt_secret and secret == jwt_secret)
        ):
            raise ValueError(INTEGRITY_SECRET_PRODUCTION_ERROR)

        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
