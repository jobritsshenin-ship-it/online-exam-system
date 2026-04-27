from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

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
    password: str
    role: UserRole = UserRole.STUDENT
    register_number: str | None = None
    department: str | None = None
    batch: str | None = None
    class_name: str | None = None
    is_active: bool = True
    is_superuser: bool = False


class UserRead(UserBase):
    id: int
    is_superuser: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
