"""Persist read intent so retries cannot apply obsolete read/unread commands."""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "messages",
        sa.Column("read_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("messages", sa.Column("desired_read", sa.Boolean(), nullable=True))


def downgrade():
    op.drop_column("messages", "desired_read")
    op.drop_column("messages", "read_revision")
