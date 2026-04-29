"""Add exam archive flag

Revision ID: 20260429_0007
Revises: 20260427_0006
Create Date: 2026-04-29 00:07:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "20260429_0007"
down_revision = "20260427_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exams",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(op.f("ix_exams_is_archived"), "exams", ["is_archived"], unique=False)
    op.alter_column("exams", "is_archived", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_exams_is_archived"), table_name="exams")
    op.drop_column("exams", "is_archived")
