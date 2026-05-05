"""Add result integrity state and security alerts

Revision ID: 20260505_0010
Revises: 20260504_0009
Create Date: 2026-05-05 00:10:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "20260505_0010"
down_revision = "20260504_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("submissions", sa.Column("integrity_hash", sa.String(length=128), nullable=True))
    op.add_column(
        "submissions",
        sa.Column(
            "integrity_status",
            sa.String(length=20),
            server_default="unverified",
            nullable=False,
        ),
    )
    op.add_column("submissions", sa.Column("integrity_checked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("submissions", sa.Column("integrity_sealed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_submissions_integrity_status"), "submissions", ["integrity_status"], unique=False)
    op.create_check_constraint(
        "ck_submissions_integrity_status",
        "submissions",
        "integrity_status IN ('unverified', 'verified', 'tampered')",
    )

    op.create_table(
        "security_alerts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("alert_type", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=True),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("metadata", sa.Text(), nullable=True),
        sa.Column("is_resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_admin_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "severity IN ('info', 'warning', 'critical')",
            name="ck_security_alerts_severity",
        ),
        sa.ForeignKeyConstraint(["resolved_by_admin_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_security_alerts_id"), "security_alerts", ["id"], unique=False)
    op.create_index(op.f("ix_security_alerts_severity"), "security_alerts", ["severity"], unique=False)
    op.create_index(op.f("ix_security_alerts_alert_type"), "security_alerts", ["alert_type"], unique=False)
    op.create_index(op.f("ix_security_alerts_entity_type"), "security_alerts", ["entity_type"], unique=False)
    op.create_index(op.f("ix_security_alerts_entity_id"), "security_alerts", ["entity_id"], unique=False)
    op.create_index(op.f("ix_security_alerts_is_resolved"), "security_alerts", ["is_resolved"], unique=False)
    op.create_index(
        op.f("ix_security_alerts_resolved_by_admin_id"),
        "security_alerts",
        ["resolved_by_admin_id"],
        unique=False,
    )
    op.create_index(op.f("ix_security_alerts_created_at"), "security_alerts", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_security_alerts_created_at"), table_name="security_alerts")
    op.drop_index(op.f("ix_security_alerts_resolved_by_admin_id"), table_name="security_alerts")
    op.drop_index(op.f("ix_security_alerts_is_resolved"), table_name="security_alerts")
    op.drop_index(op.f("ix_security_alerts_entity_id"), table_name="security_alerts")
    op.drop_index(op.f("ix_security_alerts_entity_type"), table_name="security_alerts")
    op.drop_index(op.f("ix_security_alerts_alert_type"), table_name="security_alerts")
    op.drop_index(op.f("ix_security_alerts_severity"), table_name="security_alerts")
    op.drop_index(op.f("ix_security_alerts_id"), table_name="security_alerts")
    op.drop_table("security_alerts")

    op.drop_constraint("ck_submissions_integrity_status", "submissions", type_="check")
    op.drop_index(op.f("ix_submissions_integrity_status"), table_name="submissions")
    op.drop_column("submissions", "integrity_sealed_at")
    op.drop_column("submissions", "integrity_checked_at")
    op.drop_column("submissions", "integrity_status")
    op.drop_column("submissions", "integrity_hash")
