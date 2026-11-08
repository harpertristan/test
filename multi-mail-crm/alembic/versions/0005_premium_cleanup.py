"""Suppress and trash Inbox.eu premium activation confirmations."""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""UPDATE messages SET deleted_at=coalesce(deleted_at,now()),
        delete_reason='inbox_premium', is_read=true, needs_reply=false,
        desired_read=NULL, processing_state='done'
        WHERE direction='in' AND lower(trim(from_email))='orders@inbox.eu'
        AND lower(trim(subject))='thank you! premium subscription activated!'""")
    op.execute("""UPDATE messages SET is_read=true, needs_reply=false, desired_read=NULL
        WHERE delete_reason IN ('inbox_sign_in','inbox_premium')""")
    op.execute("""UPDATE notifications SET is_seen=true WHERE message_id IN
        (SELECT id FROM messages WHERE delete_reason IN ('inbox_sign_in','inbox_premium'))""")
    op.execute("""UPDATE mail_accounts a SET
        unread_count=(SELECT count(*) FROM messages m WHERE m.mail_account_id=a.id AND m.direction='in' AND NOT m.is_read AND m.deleted_at IS NULL),
        last_unread_at=(SELECT max(received_at) FROM messages m WHERE m.mail_account_id=a.id AND m.direction='in' AND NOT m.is_read AND m.deleted_at IS NULL),
        current_status=(SELECT category FROM messages m WHERE m.mail_account_id=a.id AND m.direction='in' AND NOT m.is_read AND m.deleted_at IS NULL
        ORDER BY CASE category WHEN 'add_request' THEN 0 WHEN 'decline' THEN 1 WHEN 'approve' THEN 2 WHEN 'other' THEN 3 WHEN 'ad' THEN 4 ELSE 99 END, received_at DESC LIMIT 1)""")


def downgrade():
    # Remote Trash moves cannot safely be undone by rolling back a schema version.
    pass
