from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.utils.enums import UserRole


PASSWORD_COMPLEXITY_ERROR = "Password must include uppercase, lowercase, number, and special character."


def validate_password_complexity(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters.")

    has_uppercase = any(char.isupper() for char in value)
    has_lowercase = any(char.islower() for char in value)
    has_number = any(char.isdigit() for char in value)
    has_special = any(not char.isalnum() and not char.isspace() for char in value)

    if not all((has_uppercase, has_lowercase, has_number, has_special)):
        raise ValueError(PASSWORD_COMPLEXITY_ERROR)

    return value


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    role: UserRole
    register_number: str | None = None
    department: str | None = None
    batch: str | None = None
    class_name: str | None = None
    is_active: bool = True


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str = Field(min_length=8)
    role: UserRole = UserRole.STUDENT
    register_number: str | None = None
    department: str | None = None
    batch: str | None = None
    class_name: str | None = None
    is_active: bool = True
    is_superuser: bool = False

    @field_validator("password")
    @classmethod
    def password_must_be_complex(cls, value: str) -> str:
        return validate_password_complexity(value)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    role: UserRole | None = None
    register_number: str | None = None
    department: str | None = None
    batch: str | None = None
    class_name: str | None = None
    is_active: bool | None = None
    is_superuser: bool | None = None


class PasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=8)

    @field_validator("new_password")
    @classmethod
    def new_password_must_be_complex(cls, value: str) -> str:
        return validate_password_complexity(value)


class MessageResponse(BaseModel):
    message: str


class UserRead(UserBase):
    id: int
    is_superuser: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
