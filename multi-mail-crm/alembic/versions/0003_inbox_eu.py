"""Add Inbox.eu and retire Mail.ru without deleting historical accounts or mail."""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_account_provider", "mail_accounts", type_="check")
    op.create_check_constraint(
        "ck_account_provider",
        "mail_accounts",
        "provider IN ('zoho_eu','gmail','inbox_eu','imap_inbox')",
    )
    # Preserve old records for history, but never contact retired Mail.ru servers.
    op.execute(
        "UPDATE mail_accounts SET is_active=false WHERE provider='imap_inbox' AND lower(email) NOT LIKE '%@inbox.eu'"
    )
    # Previously entered Inbox.eu addresses used the wrong Mail.ru connector.
    # Restart their cursor because remote UID spaces are provider-specific.
    op.execute("""UPDATE mail_accounts SET provider='inbox_eu',
        imap_host='mail.inbox.eu', imap_port=993,
        smtp_host='mail.inbox.eu', smtp_port=465, imap_user=email,
        sync_state='{}'::jsonb, last_uid=NULL, last_sync_at=NULL, last_error=NULL
        WHERE provider='imap_inbox' AND lower(email) LIKE '%@inbox.eu'""")


def downgrade():
    op.execute("""UPDATE mail_accounts SET provider='imap_inbox', is_active=false,
        imap_host=NULL, smtp_host=NULL, sync_state='{}'::jsonb,
        last_uid=NULL, last_sync_at=NULL WHERE provider='inbox_eu'""")
    op.drop_constraint("ck_account_provider", "mail_accounts", type_="check")
    op.create_check_constraint(
        "ck_account_provider",
        "mail_accounts",
        "provider IN ('zoho_eu','gmail','imap_inbox')",
    )
