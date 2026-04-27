"""review answers and proctoring events

Revision ID: 20260417_0002
Revises: 20260417_0001
Create Date: 2026-04-17 00:00:01.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260417_0002"
down_revision: Union[str, None] = "20260417_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "submission_answers",
        sa.Column(
            "is_marked_for_review",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    op.create_table(
        "submission_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("submission_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["submission_id"], ["submissions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_submission_events_event_type"), "submission_events", ["event_type"], unique=False)
    op.create_index(op.f("ix_submission_events_id"), "submission_events", ["id"], unique=False)
    op.create_index(op.f("ix_submission_events_submission_id"), "submission_events", ["submission_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_submission_events_submission_id"), table_name="submission_events")
    op.drop_index(op.f("ix_submission_events_id"), table_name="submission_events")
    op.drop_index(op.f("ix_submission_events_event_type"), table_name="submission_events")
    op.drop_table("submission_events")
    op.drop_column("submission_answers", "is_marked_for_review")
