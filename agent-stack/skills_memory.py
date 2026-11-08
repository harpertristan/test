"""Hermes local skill memory. Proposed lessons never become trusted instructions until review.

This module never sends data to the Internet and never modifies program source.
The agent can recall approved lessons and propose new ones; an operator reviews
promotion using the CLI from a trusted environment. All stored records are
plain-language operational runbooks, NOT prompts from arbitrary web pages.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from datetime import datetime, timezone

ROOT = Path(os.environ.get("HERMES_SKILLS_DIR", "/opt/data/skills"))
MAX_APPROVED = 80
MAX_PENDING = 100
SUSPICIOUS = (
    re.compile(r"(?i)(?:api[_-]?key|password|secret|authorization|bearer)\s*[:=]\s*\S+"),
    re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{15,}"),
    re.compile(r"-----BEGIN [^-]*PRIVATE KEY-----"),
    re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"),
    re.compile(r"\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b"),
    re.compile(r"(?i)\b(?:ignore previous|system prompt|developer instructions|"
               r"override permissions|send credentials)\b"),
)


class SkillsError(ValueError):
    pass


def _text(value, field, limit):
    if not isinstance(value, str) or not 12 <= len(value.strip()) <= limit:
        raise SkillsError(field + " must be plain text within allowed length")
    if any(x.search(value) for x in SUSPICIOUS) or any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise SkillsError(field + " might contain private data or untrusted instructions")
    return value.strip()


def _folder(path: Path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise SkillsError("Invalid skills storage directory")
    os.chmod(path, 0o700)


def _write_new(path: Path, record: dict):
    data = json.dumps(record, ensure_ascii=False, sort_keys=True, indent=2).encode()
    if len(data) > 6000:
        raise SkillsError("Lesson too large")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "wb") as file:
        file.write(data)


def _load(path: Path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 6000:
        raise SkillsError("Invalid stored lesson")
    try:
        result = json.loads(path.read_text())
        if not isinstance(result, dict) or set(result) != {"id", "lesson", "evidence", "createdAt"}:
            raise SkillsError("Invalid lesson schema")
        _text(result["lesson"], "lesson", 1200)
        _text(result["evidence"], "evidence", 1000)
        return result
    except (json.JSONDecodeError, OSError, KeyError, TypeError) as err:
        raise SkillsError("Stored lesson is invalid") from err


def propose(lesson, evidence, root=ROOT):
    lesson = _text(lesson, "lesson", 1200)
    evidence = _text(evidence, "evidence", 1000)
    _folder(root)
    pending = root / "pending"
    _folder(pending)
    if len(list(pending.glob("*.json"))) >= MAX_PENDING:
        raise SkillsError("Skill review queue full")
    digest = hashlib.sha256((lesson + "\n" + evidence).encode()).hexdigest()[:24]
    path = pending / (digest + ".json")
    record = {"id": digest, "lesson": lesson, "evidence": evidence,
              "createdAt": datetime.now(timezone.utc).isoformat()}
    if path.exists():
        return {"status": "already_pending", "id": digest, "approved": False}
    try:
        _write_new(path, record)
    except FileExistsError:
        return {"status": "already_pending", "id": digest, "approved": False}
    return {"status": "awaiting_review", "id": digest, "approved": False}


def recall(root=ROOT):
    approved = root / "approved"
    if not approved.is_dir() or approved.is_symlink():
        return {"lessons": [], "status": "empty"}
    result = []
    for path in sorted(approved.glob("*.json"))[:MAX_APPROVED]:
        try:
            record = _load(path)
            result.append({"id": record["id"], "lesson": record["lesson"]})
        except SkillsError:
            continue
    return {"lessons": result, "status": "ok"}


def approve(lesson_id, root=ROOT):
    if not isinstance(lesson_id, str) or not re.fullmatch(r"[0-9a-f]{24}", lesson_id):
        raise SkillsError("Invalid lesson ID")
    _folder(root)
    pending = root / "pending"
    approved = root / "approved"
    _folder(pending)
    _folder(approved)
    if len(list(approved.glob("*.json"))) >= MAX_APPROVED:
        raise SkillsError("Approved skills limit reached")
    source = pending / (lesson_id + ".json")
    record = _load(source)
    if record["id"] != lesson_id:
        raise SkillsError("Mismatched lesson")
    target = approved / (lesson_id + ".json")
    if target.exists():
        raise SkillsError("Lesson already approved")
    # Atomic promotion. Only trusted operator CLI invokes this, never MCP.
    os.replace(source, target)
    return {"status": "approved", "id": lesson_id}


def mcp(action, lesson=None, evidence=None, root=ROOT):
    if action == "recall" and lesson is None and evidence is None:
        return recall(root)
    if action == "propose" and lesson is not None and evidence is not None:
        return propose(lesson, evidence, root)
    raise SkillsError("Invalid skill action")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trusted local skill reviewer")
    parser.add_argument("action", choices=["recall", "approve"])
    parser.add_argument("id", nargs="?")
    args = parser.parse_args()
    if args.action == "approve" and args.id:
        print(json.dumps(approve(args.id), ensure_ascii=False))
    elif args.action == "recall" and args.id is None:
        print(json.dumps(recall(), ensure_ascii=False))
    else:
        parser.error("approve requires an exact lesson id")
