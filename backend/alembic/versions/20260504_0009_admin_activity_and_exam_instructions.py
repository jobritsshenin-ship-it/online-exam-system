"""Add admin activity logs and exam instructions

Revision ID: 20260504_0009
Revises: 20260429_0008
Create Date: 2026-05-04 00:09:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "20260504_0009"
down_revision = "20260429_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("exams", sa.Column("instructions", sa.Text(), nullable=True))

    op.create_table(
        "admin_activity_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_id", sa.Integer(), nullable=True),
        sa.Column("admin_email", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=True),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["admin_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_admin_activity_logs_id"), "admin_activity_logs", ["id"], unique=False)
    op.create_index(op.f("ix_admin_activity_logs_admin_id"), "admin_activity_logs", ["admin_id"], unique=False)
    op.create_index(op.f("ix_admin_activity_logs_admin_email"), "admin_activity_logs", ["admin_email"], unique=False)
    op.create_index(op.f("ix_admin_activity_logs_action"), "admin_activity_logs", ["action"], unique=False)
    op.create_index(op.f("ix_admin_activity_logs_entity_type"), "admin_activity_logs", ["entity_type"], unique=False)
    op.create_index(op.f("ix_admin_activity_logs_entity_id"), "admin_activity_logs", ["entity_id"], unique=False)
    op.create_index(op.f("ix_admin_activity_logs_created_at"), "admin_activity_logs", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_activity_logs_created_at"), table_name="admin_activity_logs")
    op.drop_index(op.f("ix_admin_activity_logs_entity_id"), table_name="admin_activity_logs")
    op.drop_index(op.f("ix_admin_activity_logs_entity_type"), table_name="admin_activity_logs")
    op.drop_index(op.f("ix_admin_activity_logs_action"), table_name="admin_activity_logs")
    op.drop_index(op.f("ix_admin_activity_logs_admin_email"), table_name="admin_activity_logs")
    op.drop_index(op.f("ix_admin_activity_logs_admin_id"), table_name="admin_activity_logs")
    op.drop_index(op.f("ix_admin_activity_logs_id"), table_name="admin_activity_logs")
    op.drop_table("admin_activity_logs")
    op.drop_column("exams", "instructions")
