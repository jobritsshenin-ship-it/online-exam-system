"""Add student metadata fields

Revision ID: 20260422_0004
Revises: 20260422_0003
Create Date: 2026-04-22 00:04:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "20260422_0004"
down_revision = "20260422_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("register_number", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("department", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("batch", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("class_name", sa.String(length=100), nullable=True))
    op.create_index(op.f("ix_users_register_number"), "users", ["register_number"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_register_number"), table_name="users")
    op.drop_column("users", "class_name")
    op.drop_column("users", "batch")
    op.drop_column("users", "department")
    op.drop_column("users", "register_number")
