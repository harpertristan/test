"""Persistent trash intents and automatic Inbox.eu sign-in notice cleanup."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    for name in ("deleted_at", "trashed_at", "trash_retry_at"):
        op.add_column(
            "messages", sa.Column(name, sa.DateTime(timezone=True), nullable=True)
        )
    for name in ("delete_reason", "trash_error"):
        op.add_column("messages", sa.Column(name, sa.Text(), nullable=True))
    op.create_index(
        "idx_msg_trash_pending",
        "messages",
        ["trash_retry_at"],
        postgresql_where=sa.text("deleted_at IS NOT NULL AND trashed_at IS NULL"),
    )
    # Existing matching messages are authorized for the same automatic rule.
    op.execute("""UPDATE messages SET deleted_at=now(), delete_reason='inbox_sign_in',
        needs_reply=false, desired_read=NULL, processing_state='done'
        WHERE direction='in' AND lower(trim(from_email))='support@inbox.eu'
        AND trim(subject) ~* '^New sign in from [^\\r\\n]+ to your email$'""")
    op.execute("""UPDATE notifications SET is_seen=true
        WHERE message_id IN (SELECT id FROM messages WHERE deleted_at IS NOT NULL)""")
    # Reconcile counters before publishing the new API.
    op.execute("""UPDATE mail_accounts a SET
        unread_count=(SELECT count(*) FROM messages m WHERE m.mail_account_id=a.id AND m.direction='in' AND NOT m.is_read AND m.deleted_at IS NULL),
        last_unread_at=(SELECT max(received_at) FROM messages m WHERE m.mail_account_id=a.id AND m.direction='in' AND NOT m.is_read AND m.deleted_at IS NULL),
        current_status=(SELECT category FROM messages m WHERE m.mail_account_id=a.id AND m.direction='in' AND NOT m.is_read AND m.deleted_at IS NULL
        ORDER BY CASE category WHEN 'add_request' THEN 0 WHEN 'decline' THEN 1 WHEN 'approve' THEN 2 WHEN 'other' THEN 3 WHEN 'ad' THEN 4 ELSE 99 END, received_at DESC LIMIT 1)""")


def downgrade():
    # Does not restore remote mail: recovery is available through the provider's Trash.
    op.drop_index("idx_msg_trash_pending", table_name="messages")
    for name in (
        "trash_error",
        "delete_reason",
        "trash_retry_at",
        "trashed_at",
        "deleted_at",
    ):
        op.drop_column("messages", name)
