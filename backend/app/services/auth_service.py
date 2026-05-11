import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.redis.client import delete_value, get_value, increment_counter
from app.schemas.user import UserCreate, UserUpdate
from app.utils.enums import UserRole


LOGIN_RATE_LIMIT_ATTEMPTS = 5
LOGIN_RATE_LIMIT_SECONDS = 15 * 60
STUDENT_EMAIL_DOMAIN = "stellamaryscoe.edu.in"
REGISTER_NUMBER_PATTERN = re.compile(r"^9635\d{8}$")
REGISTER_NUMBER_ERROR = "Register number must be a 12-digit number starting with 9635."
REGISTER_NUMBER_DUPLICATE_ERROR = "Register number already belongs to another student."


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_user_by_email(db: Session, email: str) -> User | None:
    statement = select(User).where(User.email == normalize_email(email))
    return db.execute(statement).scalar_one_or_none()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    statement = select(User).where(User.id == user_id)
    return db.execute(statement).scalar_one_or_none()


def list_users(db: Session) -> list[User]:
    statement = select(User).order_by(User.created_at.desc(), User.id.desc())
    return list(db.execute(statement).scalars().all())


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _normalize_student_name(full_name: str) -> str:
    return full_name.strip().upper()


def _validate_student_register_number(register_number: str | None) -> str:
    cleaned = _clean_optional(register_number)
    if not cleaned or not REGISTER_NUMBER_PATTERN.fullmatch(cleaned):
        raise ValueError(REGISTER_NUMBER_ERROR)
    return cleaned


def _ensure_unique_student_register_number(
    db: Session,
    register_number: str,
    exclude_user_id: int | None = None,
) -> None:
    statement = select(User).where(
        User.role == UserRole.STUDENT,
        User.register_number == register_number,
    )
    if exclude_user_id is not None:
        statement = statement.where(User.id != exclude_user_id)

    if db.execute(statement).scalar_one_or_none():
        raise ValueError(REGISTER_NUMBER_DUPLICATE_ERROR)


def _active_admin_count(db: Session) -> int:
    statement = select(func.count()).select_from(User).where(
        User.role == UserRole.ADMIN,
        User.is_active.is_(True),
    )
    return int(db.execute(statement).scalar_one())


def _ensure_not_removing_last_admin(db: Session, target_user: User, updates: dict) -> None:
    will_be_admin = updates.get("role", target_user.role) == UserRole.ADMIN
    will_be_active = updates.get("is_active", target_user.is_active)
    if target_user.role == UserRole.ADMIN and (not will_be_admin or not will_be_active):
        if _active_admin_count(db) <= 1:
            raise ValueError("Cannot remove or deactivate the last active admin.")


def create_user(db: Session, user_in: UserCreate, current_admin: User | None = None) -> User:
    existing_user = get_user_by_email(db, user_in.email)
    if existing_user:
        raise ValueError("A user with this email already exists.")

    if not user_in.full_name or not user_in.full_name.strip():
        raise ValueError("Full name is required.")

    if not user_in.password:
        raise ValueError("Password is required.")

    is_superuser = user_in.is_superuser
    if current_admin is not None and not current_admin.is_superuser:
        is_superuser = False

    full_name = user_in.full_name.strip()
    register_number = _clean_optional(user_in.register_number)
    if user_in.role == UserRole.STUDENT:
        full_name = _normalize_student_name(full_name)
        register_number = _validate_student_register_number(user_in.register_number)
        _ensure_unique_student_register_number(db, register_number)

    user = User(
        email=normalize_email(user_in.email),
        full_name=full_name,
        password_hash=hash_password(user_in.password),
        role=user_in.role,
        register_number=register_number,
        department=_clean_optional(user_in.department),
        batch=_clean_optional(user_in.batch),
        class_name=_clean_optional(user_in.class_name),
        is_active=user_in.is_active,
        is_superuser=is_superuser,
    )

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_student_user(db: Session, user_in: UserCreate) -> User:
    email = normalize_email(user_in.email)
    if not email.endswith(f"@{STUDENT_EMAIL_DOMAIN}"):
        raise ValueError("Use your official Stella Mary’s institutional email address.")

    if not user_in.full_name or not user_in.full_name.strip():
        raise ValueError("Full name is required.")

    if not user_in.password:
        raise ValueError("Password is required.")

    register_number = _validate_student_register_number(user_in.register_number)

    if not user_in.department or not user_in.department.strip():
        raise ValueError("Department is required.")

    student_in = UserCreate(
        email=email,
        full_name=user_in.full_name.strip(),
        password=user_in.password,
        role=UserRole.STUDENT,
        register_number=register_number,
        department=user_in.department.strip(),
        batch=user_in.batch.strip() if user_in.batch else "",
        class_name=user_in.class_name.strip() if user_in.class_name else None,
        is_active=True,
        is_superuser=False,
    )
    return create_user(db, student_in)


def update_user(db: Session, user_id: int, user_in: UserUpdate, current_admin: User) -> User:
    user = get_user_by_id(db, user_id)
    if not user:
        raise LookupError("User not found.")

    updates = user_in.model_dump(exclude_unset=True)

    if "email" in updates and updates["email"] is not None:
        email = normalize_email(updates["email"])
        existing_user = get_user_by_email(db, email)
        if existing_user and existing_user.id != user.id:
            raise ValueError("A user with this email already exists.")
        updates["email"] = email

    effective_role = updates.get("role", user.role)

    if "role" in updates and updates["role"] != user.role and not current_admin.is_superuser:
        raise ValueError("Only a superuser can change user roles.")

    if "full_name" in updates:
        full_name = updates["full_name"]
        if not full_name or not full_name.strip():
            raise ValueError("Full name is required.")
        updates["full_name"] = (
            _normalize_student_name(full_name)
            if effective_role == UserRole.STUDENT
            else full_name.strip()
        )
    elif effective_role == UserRole.STUDENT and updates.get("role") == UserRole.STUDENT:
        updates["full_name"] = _normalize_student_name(user.full_name)

    for field in ("register_number", "department", "batch", "class_name"):
        if field in updates:
            updates[field] = _clean_optional(updates[field])

    if effective_role == UserRole.STUDENT and ("register_number" in updates or updates.get("role") == UserRole.STUDENT):
        register_number = _validate_student_register_number(updates.get("register_number", user.register_number))
        _ensure_unique_student_register_number(db, register_number, exclude_user_id=user.id)
        updates["register_number"] = register_number

    if "is_superuser" in updates and not current_admin.is_superuser:
        updates["is_superuser"] = False

    if user.id == current_admin.id and updates.get("is_active") is False:
        raise ValueError("You cannot deactivate your own account.")

    _ensure_not_removing_last_admin(db, user, updates)

    for field, value in updates.items():
        setattr(user, field, value)

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def reset_user_password(db: Session, user_id: int, new_password: str) -> User:
    user = get_user_by_id(db, user_id)
    if not user:
        raise LookupError("User not found.")

    user.password_hash = hash_password(new_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def deactivate_user(db: Session, user_id: int, current_admin: User) -> User:
    user = get_user_by_id(db, user_id)
    if not user:
        raise LookupError("User not found.")

    if user.id == current_admin.id:
        raise ValueError("You cannot deactivate your own account.")

    _ensure_not_removing_last_admin(db, user, {"is_active": False})
    user.is_active = False
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    email = normalize_email(email)
    user = get_user_by_email(db, email)
    if not user:
        return None

    if not verify_password(password, user.password_hash):
        return None

    if not user.is_active:
        return None

    return user


def login_user(db: Session, email: str, password: str) -> dict:
    email = normalize_email(email)
    fail_key = f"login_fail:{email}"
    fail_count = get_value(fail_key)
    if fail_count:
        try:
            attempts = int(fail_count)
        except ValueError:
            attempts = 0

        if attempts >= LOGIN_RATE_LIMIT_ATTEMPTS:
            raise ValueError("Too many failed login attempts. Try again later.")

    user = authenticate_user(db, email=email, password=password)
    if not user:
        increment_counter(fail_key, expiry_seconds=LOGIN_RATE_LIMIT_SECONDS)
        raise ValueError("Invalid email or password.")

    delete_value(fail_key)
    token = create_access_token(subject=user.email, role=user.role.value)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user,
    }


def ensure_first_admin(db: Session, email: str, password: str, full_name: str) -> User:
    existing_admin = get_user_by_email(db, email)
    if existing_admin:
        return existing_admin

    admin = User(
        email=email,
        full_name=full_name,
        password_hash=hash_password(password),
        role=UserRole.ADMIN,
        is_active=True,
        is_superuser=True,
    )

    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin
