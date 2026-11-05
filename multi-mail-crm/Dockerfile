# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.lock ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    pip install --no-cache-dir --require-hashes -r requirements.lock && \
    useradd --uid 10001 --create-home crm && mkdir /state && chown crm:crm /state
# One source layer avoids copying the installed dependencies in every VFS layer.
# .dockerignore excludes credentials, backups, frontend builds and legacy snapshots.
COPY --chown=crm:crm . /app
USER crm
CMD ["sh", "scripts/start-api.sh"]
