import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap_owner


class OwnerBootstrapTests(unittest.TestCase):
    def test_owner_claim_closes_registration_and_never_prints_password_or_invite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            token = "pcp_bootstrap_" + "a" * 48
            password = "synthetic-owner-password"
            output = io.StringIO()
            with (
                patch.object(bootstrap_owner, "ROOT", root),
                patch.object(bootstrap_owner.os, "geteuid", return_value=0),
                patch.object(
                    bootstrap_owner,
                    "read_identity",
                    return_value=("owner@example.com", "Owner", password),
                ),
                patch.object(bootstrap_owner, "create_invite", return_value=token),
                patch.object(bootstrap_owner, "run", return_value="") as run,
                patch.object(
                    bootstrap_owner,
                    "post",
                    side_effect=[{}, {}, {"bootstrapAccepted": True}],
                ) as post,
                contextlib.redirect_stdout(output),
            ):
                bootstrap_owner.main()
            self.assertNotIn(password, output.getvalue())
            self.assertNotIn(token, output.getvalue())
            self.assertEqual(
                post.call_args_list[-1].args[1], "/api/invites/" + token + "/accept"
            )
            self.assertNotIn(password, str(run.call_args_list))
            self.assertEqual(run.call_count, 2)
            self.assertNotIn(
                "paperclip-owner-bootstrap.yaml",
                " ".join(run.call_args_list[-1].args[0]),
            )
            self.assertFalse((root / "private/paperclip-owner-bootstrap.yaml").exists())

    def test_registration_is_closed_when_authentication_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "private").mkdir()
            with (
                patch.object(bootstrap_owner, "ROOT", root),
                patch.object(bootstrap_owner.os, "geteuid", return_value=0),
                patch.object(
                    bootstrap_owner,
                    "read_identity",
                    return_value=("owner@example.com", "Owner", "synthetic-password"),
                ),
                patch.object(
                    bootstrap_owner,
                    "create_invite",
                    return_value="pcp_bootstrap_" + "b" * 48,
                ),
                patch.object(bootstrap_owner, "run", return_value="") as run,
                patch.object(
                    bootstrap_owner,
                    "post",
                    side_effect=urllib.error.URLError("synthetic error"),
                ),
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaises(urllib.error.URLError),
            ):
                bootstrap_owner.main()
            self.assertEqual(run.call_count, 2)
            self.assertNotIn(
                "paperclip-owner-bootstrap.yaml",
                " ".join(run.call_args_list[-1].args[0]),
            )
            self.assertFalse((root / "private/paperclip-owner-bootstrap.yaml").exists())

    def test_external_post_paths_are_rejected(self):
        with self.assertRaises(ValueError):
            bootstrap_owner.post(None, "https://example.com", {})
