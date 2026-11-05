"""Initial CRM schema, frozen independently of model changes."""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

DDL = [
    "\nCREATE TABLE companies (\n\tname TEXT NOT NULL, \n\tinn TEXT, \n\twebsite TEXT, \n\tphone TEXT, \n\taddress TEXT, \n\tnotes TEXT, \n\tis_flagged BOOLEAN DEFAULT false NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id)\n)\n\n",
    "\nCREATE TABLE outbox (\n\tevent_key TEXT NOT NULL, \n\tpayload JSONB NOT NULL, \n\tdelivered_at TIMESTAMP WITH TIME ZONE, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (event_key)\n)\n\n",
    "CREATE INDEX idx_outbox_pending ON outbox (created_at) WHERE delivered_at IS NULL",
    "\nCREATE TABLE users (\n\temail TEXT NOT NULL, \n\tfull_name TEXT, \n\trole TEXT DEFAULT 'operator' NOT NULL, \n\tpassword_hash TEXT NOT NULL, \n\ttelegram_id BIGINT, \n\ttg_linked_at TIMESTAMP WITH TIME ZONE, \n\tis_active BOOLEAN DEFAULT true NOT NULL, \n\ttoken_version INTEGER DEFAULT '0' NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_user_role CHECK (role IN ('admin','operator')), \n\tUNIQUE (email), \n\tUNIQUE (telegram_id)\n)\n\n",
    "\nCREATE TABLE mail_accounts (\n\tcompany_id UUID NOT NULL, \n\tprovider TEXT NOT NULL, \n\temail TEXT NOT NULL, \n\tdisplay_name TEXT, \n\toauth_token JSONB, \n\torganization_id TEXT, \n\tprovider_account_id TEXT, \n\tsync_state JSONB DEFAULT '{}'::jsonb NOT NULL, \n\timap_host TEXT, \n\timap_port INTEGER, \n\timap_user TEXT, \n\timap_pass_enc BYTEA, \n\tsmtp_host TEXT, \n\tsmtp_port INTEGER, \n\tlast_uid BIGINT, \n\tlast_sync_at TIMESTAMP WITH TIME ZONE, \n\tlast_error TEXT, \n\tis_active BOOLEAN DEFAULT true NOT NULL, \n\tunread_count INTEGER DEFAULT '0' NOT NULL, \n\tcurrent_status TEXT, \n\tlast_unread_at TIMESTAMP WITH TIME ZONE, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_account_provider CHECK (provider IN ('zoho_eu','gmail','imap_inbox')), \n\tFOREIGN KEY(company_id) REFERENCES companies (id) ON DELETE RESTRICT, \n\tUNIQUE (email)\n)\n\n",
    "CREATE INDEX ix_mail_accounts_company_id ON mail_accounts (company_id)",
    "\nCREATE TABLE account_preferences (\n\tuser_id UUID NOT NULL, \n\tmail_account_id UUID NOT NULL, \n\tis_favorite BOOLEAN DEFAULT false NOT NULL, \n\tPRIMARY KEY (user_id, mail_account_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, \n\tFOREIGN KEY(mail_account_id) REFERENCES mail_accounts (id) ON DELETE CASCADE\n)\n\n",
    "\nCREATE TABLE ai_rules (\n\tmail_account_id UUID NOT NULL, \n\tname TEXT, \n\tmatch_from TEXT, \n\tmatch_subject TEXT, \n\tmatch_keywords TEXT[], \n\taction TEXT, \n\tprompt TEXT, \n\ttemplate TEXT, \n\tis_active BOOLEAN DEFAULT true NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(mail_account_id) REFERENCES mail_accounts (id) ON DELETE CASCADE\n)\n\n",
    "\nCREATE TABLE messages (\n\tmail_account_id UUID NOT NULL, \n\tcompany_id UUID NOT NULL, \n\tdirection TEXT NOT NULL, \n\tremote_id TEXT, \n\tmessage_id TEXT, \n\tthread_id TEXT, \n\tfrom_email TEXT, \n\tfrom_name TEXT, \n\tto_emails TEXT[] DEFAULT '{}' NOT NULL, \n\tsubject TEXT, \n\tbody_text TEXT, \n\tbody_html TEXT, \n\treceived_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tis_read BOOLEAN DEFAULT false NOT NULL, \n\tis_flagged BOOLEAN DEFAULT false NOT NULL, \n\tcategory TEXT, \n\tcategory_conf FLOAT, \n\tcategory_reason TEXT, \n\tclassified_at TIMESTAMP WITH TIME ZONE, \n\treplied_at TIMESTAMP WITH TIME ZONE, \n\tneeds_reply BOOLEAN DEFAULT false NOT NULL, \n\tai_handled BOOLEAN DEFAULT false NOT NULL, \n\tai_draft TEXT, \n\traw_headers JSONB DEFAULT '{}'::jsonb NOT NULL, \n\tprocessing_state TEXT DEFAULT 'pending' NOT NULL, \n\tsend_state TEXT, \n\tsend_error TEXT, \n\treply_to_id UUID, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT uq_message_remote UNIQUE (mail_account_id, remote_id), \n\tCONSTRAINT ck_message_direction CHECK (direction IN ('in','out')), \n\tCONSTRAINT ck_message_category CHECK (category IS NULL OR category IN ('ad','add_request','approve','decline','other')), \n\tCONSTRAINT ck_message_conf CHECK (category_conf IS NULL OR (category_conf >= 0 AND category_conf <= 1)), \n\tFOREIGN KEY(mail_account_id) REFERENCES mail_accounts (id) ON DELETE CASCADE, \n\tFOREIGN KEY(company_id) REFERENCES companies (id) ON DELETE RESTRICT, \n\tFOREIGN KEY(reply_to_id) REFERENCES messages (id) ON DELETE SET NULL\n)\n\n",
    "CREATE INDEX idx_msg_acc_recv ON messages (mail_account_id, received_at DESC, id DESC)",
    "CREATE INDEX idx_msg_company_recv ON messages (company_id, received_at DESC, id DESC)",
    "CREATE INDEX idx_msg_pending ON messages (received_at) WHERE needs_reply = true AND replied_at IS NULL",
    "CREATE INDEX idx_msg_processing ON messages (processing_state) WHERE direction = 'in' AND processing_state = 'pending'",
    "CREATE INDEX idx_msg_unread ON messages (mail_account_id) WHERE is_read = false",
    "CREATE INDEX ix_messages_company_id ON messages (company_id)",
    "CREATE INDEX ix_messages_thread_id ON messages (thread_id)",
    "\nCREATE TABLE crm_tasks (\n\tcompany_id UUID NOT NULL, \n\tmessage_id UUID, \n\tuser_id UUID NOT NULL, \n\ttitle TEXT NOT NULL, \n\tdue_at TIMESTAMP WITH TIME ZONE, \n\tis_done BOOLEAN DEFAULT false NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(company_id) REFERENCES companies (id) ON DELETE CASCADE, \n\tFOREIGN KEY(message_id) REFERENCES messages (id) ON DELETE SET NULL, \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE RESTRICT\n)\n\n",
    "CREATE INDEX ix_crm_tasks_company_id ON crm_tasks (company_id)",
    "\nCREATE TABLE notifications (\n\tuser_id UUID NOT NULL, \n\tmessage_id UUID NOT NULL, \n\tmail_account_id UUID NOT NULL, \n\tis_seen BOOLEAN DEFAULT false NOT NULL, \n\ttelegram_sent_at TIMESTAMP WITH TIME ZONE, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT uq_notification_user_message UNIQUE (user_id, message_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, \n\tFOREIGN KEY(message_id) REFERENCES messages (id) ON DELETE CASCADE, \n\tFOREIGN KEY(mail_account_id) REFERENCES mail_accounts (id) ON DELETE CASCADE\n)\n\n",
    "CREATE INDEX ix_notifications_user_id ON notifications (user_id)",
]


def upgrade():
    for statement in DDL:
        op.execute(statement)


def downgrade():
    op.execute("DROP TABLE notifications CASCADE")
    op.execute("DROP TABLE crm_tasks CASCADE")
    op.execute("DROP TABLE messages CASCADE")
    op.execute("DROP TABLE ai_rules CASCADE")
    op.execute("DROP TABLE account_preferences CASCADE")
    op.execute("DROP TABLE mail_accounts CASCADE")
    op.execute("DROP TABLE users CASCADE")
    op.execute("DROP TABLE outbox CASCADE")
    op.execute("DROP TABLE companies CASCADE")
