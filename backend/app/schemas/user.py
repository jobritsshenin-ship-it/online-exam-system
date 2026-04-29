from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.utils.enums import UserRole


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


class MessageResponse(BaseModel):
    message: str


class UserRead(UserBase):
    id: int
    is_superuser: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
