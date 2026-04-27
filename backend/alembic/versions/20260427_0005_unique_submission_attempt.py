"""Add unique submission attempt constraint

Revision ID: 20260427_0005
Revises: 20260422_0004
Create Date: 2026-04-27 00:05:00.000000

"""

from alembic import op


revision = "20260427_0005"
down_revision = "20260422_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_submission_exam_student",
        "submissions",
        ["exam_id", "student_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_submission_exam_student",
        "submissions",
        type_="unique",
    )
