from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.redis.client import delete_value, get_value, increment_counter
from app.schemas.user import UserCreate
from app.utils.enums import UserRole


LOGIN_RATE_LIMIT_ATTEMPTS = 5
LOGIN_RATE_LIMIT_SECONDS = 15 * 60


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_user_by_email(db: Session, email: str) -> User | None:
    statement = select(User).where(User.email == normalize_email(email))
    return db.execute(statement).scalar_one_or_none()


def create_user(db: Session, user_in: UserCreate) -> User:
    existing_user = get_user_by_email(db, user_in.email)
    if existing_user:
        raise ValueError("A user with this email already exists.")

    user = User(
        email=normalize_email(user_in.email),
        full_name=user_in.full_name,
        password_hash=hash_password(user_in.password),
        role=user_in.role,
        register_number=user_in.register_number,
        department=user_in.department,
        batch=user_in.batch,
        class_name=user_in.class_name,
        is_active=user_in.is_active,
        is_superuser=user_in.is_superuser,
    )

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
