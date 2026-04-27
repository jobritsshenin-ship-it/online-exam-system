"""Add structured submission event fields

Revision ID: 20260427_0006
Revises: 20260427_0005
Create Date: 2026-04-27 00:06:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "20260427_0006"
down_revision = "20260427_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "submission_events",
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="low"),
    )
    op.add_column(
        "submission_events",
        sa.Column("metadata_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submission_events", "metadata_json")
    op.drop_column("submission_events", "severity")
