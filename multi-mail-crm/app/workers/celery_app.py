import os
from celery import Celery
from celery.signals import after_setup_logger, after_setup_task_logger
from app.core.observability import configure_logging

celery_app = Celery(
    "multi_mail_crm",
    broker=os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/1"),
    include=[
        "app.workers.tasks_sync",
        "app.workers.tasks_process",
        "app.workers.tasks_pending",
        "app.workers.tasks_notify",
    ],
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    worker_prefetch_multiplier=1,
    task_ignore_result=True,
    task_default_queue="control",
    task_routes={
        "mail.sync": {"queue": "sync"},
        "mail.refresh_token": {"queue": "sync"},
        "mail.process": {"queue": "classify"},
    },
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    broker_transport_options={"visibility_timeout": 1800},
    beat_schedule={
        "poll-mailboxes": {
            "task": "mail.schedule",
            "schedule": max(60, int(os.environ.get("SYNC_INTERVAL_SECONDS", "120"))),
        },
        "recover-pending-messages": {"task": "mail.recover", "schedule": 60.0},
        "outbox": {"task": "notify.outbox", "schedule": 5.0},
        "telegram-digest": {"task": "notify.telegram", "schedule": 10.0},
        "pending-hourly": {"task": "mail.pending", "schedule": 3600.0},
        "refresh-oauth": {"task": "mail.refresh_tokens", "schedule": 600.0},
        "retention": {"task": "mail.retention", "schedule": 3600.0},
    },
)


@after_setup_logger.connect
@after_setup_task_logger.connect
def setup_logs(**kwargs):
    configure_logging()
