#!/bin/sh
set -eu
alembic upgrade head
mkdir -p /tmp/crm-prometheus
rm -f /tmp/crm-prometheus/*.db
export PROMETHEUS_MULTIPROC_DIR=/tmp/crm-prometheus
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --no-access-log
