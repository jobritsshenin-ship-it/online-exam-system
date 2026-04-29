from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, get_db, require_admin
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.user import MessageResponse, PasswordResetRequest, UserCreate, UserRead, UserUpdate
from app.services.auth_service import (
    create_student_user,
    create_user,
    deactivate_user,
    list_users,
    login_user,
    reset_user_password,
    update_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    try:
        result = login_user(db, email=payload.email, password=payload.password)
        return result
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc


@router.post("/register", response_model=UserRead)
def register_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
):
    try:
        return create_student_user(db, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/users", response_model=UserRead)
def create_user_as_admin(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return create_user(db, payload, current_admin=current_user)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get("/users", response_model=list[UserRead])
def read_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return list_users(db)


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user_as_admin(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return update_user(db, user_id, payload, current_user)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/users/{user_id}/reset-password", response_model=MessageResponse)
def reset_user_password_as_admin(
    user_id: int,
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    try:
        reset_user_password(db, user_id, payload.new_password)
        return {"message": "Password reset successfully."}
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.delete("/users/{user_id}", response_model=UserRead)
def deactivate_user_as_admin(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    try:
        return deactivate_user(db, user_id, current_user)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
