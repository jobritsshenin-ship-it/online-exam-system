"""exam subject and question explanation

Revision ID: 20260422_0003
Revises: 20260417_0002
Create Date: 2026-04-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260422_0003"
down_revision: Union[str, None] = "20260417_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("exams", sa.Column("subject", sa.String(length=255), nullable=True))
    op.create_index(op.f("ix_exams_subject"), "exams", ["subject"], unique=False)
    op.add_column("questions", sa.Column("explanation", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("questions", "explanation")
    op.drop_index(op.f("ix_exams_subject"), table_name="exams")
    op.drop_column("exams", "subject")
