from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps.auth import get_current_user, get_db, require_admin
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.user import MessageResponse, PasswordResetRequest, UserCreate, UserRead, UserUpdate
from app.services.admin_activity_service import log_admin_activity
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
        created_user = create_user(db, payload, current_admin=current_user)
        log_admin_activity(
            db,
            current_user,
            "admin_created_user",
            entity_type="user",
            entity_id=created_user.id,
            details={"email": created_user.email, "role": created_user.role.value},
        )
        return created_user
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
        updated_user = update_user(db, user_id, payload, current_user)
        updates = payload.model_dump(exclude_unset=True)
        is_deactivation = updates.get("is_active") is False
        log_admin_activity(
            db,
            current_user,
            "admin_deactivated_user" if is_deactivation else "admin_updated_user",
            entity_type="user",
            entity_id=updated_user.id,
            details=(
                f"Deactivated user {updated_user.email}"
                if is_deactivation
                else {"email": updated_user.email, "updated_fields": sorted(updates.keys())}
            ),
        )
        return updated_user
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
    current_user: User = Depends(require_admin),
):
    try:
        target_user = reset_user_password(db, user_id, payload.new_password)
        log_admin_activity(
            db,
            current_user,
            "admin_reset_password",
            entity_type="user",
            entity_id=target_user.id,
            details=f"Password reset for user {target_user.email}",
        )
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
        deactivated_user = deactivate_user(db, user_id, current_user)
        log_admin_activity(
            db,
            current_user,
            "admin_deactivated_user",
            entity_type="user",
            entity_id=deactivated_user.id,
            details=f"Deactivated user {deactivated_user.email}",
        )
        return deactivated_user
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
