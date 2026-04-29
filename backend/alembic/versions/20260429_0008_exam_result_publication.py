"""Add exam result publication flag

Revision ID: 20260429_0008
Revises: 20260429_0007
Create Date: 2026-04-29 00:08:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "20260429_0008"
down_revision = "20260429_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exams",
        sa.Column("is_result_published", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(op.f("ix_exams_is_result_published"), "exams", ["is_result_published"], unique=False)
    op.alter_column("exams", "is_result_published", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_exams_is_result_published"), table_name="exams")
    op.drop_column("exams", "is_result_published")
