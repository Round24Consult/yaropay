"""Tests for apply-env.py. Run: python3 deploy/test_apply_env.py"""
import importlib.util
import io
import os
import stat
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

spec = importlib.util.spec_from_file_location("apply_env", Path(__file__).with_name("apply-env.py"))
apply_env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apply_env)

ORIGINAL = """# Server-only settings
POSTGRES_PASSWORD=pg-secret
YAROPAY_ENCRYPTION_KEY=enc-secret

SMTP_URL=smtp://old
LOG_LEVEL=log
API_IMAGE=ghcr.io/x-api:1
"""


class ApplyEnv(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, ".env")
        Path(self.path).write_text(ORIGINAL)
        os.chmod(self.path, 0o600)

    def tearDown(self):
        self.dir.cleanup()

    def run_script(self, payload: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        sys.stdin = io.StringIO(payload)
        try:
            with redirect_stdout(out), redirect_stderr(err):
                code = apply_env.main(["apply-env.py", self.path])
        finally:
            sys.stdin = sys.__stdin__
        return code, out.getvalue(), err.getvalue()

    def backups(self):
        return sorted(f for f in os.listdir(self.dir.name) if f.startswith(".env.bak-"))

    def test_empty_input_changes_nothing(self):
        for payload in ("", "{}"):
            code, out, _ = self.run_script(payload)
            self.assertEqual(code, 0)
            self.assertIn("unchanged", out)
        self.assertEqual(Path(self.path).read_text(), ORIGINAL)
        self.assertEqual(self.backups(), [])

    def test_changes_and_adds_keeping_everything_else(self):
        code, out, _ = self.run_script('{"SMTP_URL": "smtp://new", "MAIL_FROM": "YaroPay <no-reply@yaropay.com>"}')
        self.assertEqual(code, 0)
        text = Path(self.path).read_text()
        self.assertIn("SMTP_URL=smtp://new\n", text)
        self.assertIn("MAIL_FROM='YaroPay <no-reply@yaropay.com>'\n", text)
        for kept in ("# Server-only settings", "POSTGRES_PASSWORD=pg-secret", "YAROPAY_ENCRYPTION_KEY=enc-secret", "LOG_LEVEL=log", "API_IMAGE=ghcr.io/x-api:1"):
            self.assertIn(kept, text)
        self.assertNotIn("smtp://old", text)
        # Order is kept: SMTP_URL stays where it was; new keys go at the end.
        self.assertLess(text.index("SMTP_URL="), text.index("LOG_LEVEL="))
        self.assertTrue(text.rstrip("\n").endswith("MAIL_FROM='YaroPay <no-reply@yaropay.com>'"))
        self.assertIn("Changed: SMTP_URL", out)
        self.assertIn("Added: MAIL_FROM", out)
        # Key names only, never values.
        self.assertNotIn("smtp://new", out)
        self.assertNotIn("no-reply", out)

    def test_backup_and_mode(self):
        self.run_script('{"LOG_LEVEL": "debug"}')
        backups = self.backups()
        self.assertEqual(len(backups), 1)
        backup = os.path.join(self.dir.name, backups[0])
        self.assertEqual(Path(backup).read_text(), ORIGINAL)
        self.assertEqual(stat.S_IMODE(os.stat(backup).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)
        self.assertEqual([f for f in os.listdir(self.dir.name) if f.startswith(".env.new-")], [])

    def test_keeps_the_last_five_backups(self):
        for i in range(7):
            Path(self.path + f".bak-2020010{i}T000000Z").write_text("old")
        self.run_script('{"LOG_LEVEL": "warn"}')
        backups = self.backups()
        self.assertEqual(len(backups), 5)
        self.assertNotIn(".env.bak-20200100T000000Z", backups)

    def test_same_values_are_not_rewritten(self):
        code, out, _ = self.run_script('{"LOG_LEVEL": "log"}')
        self.assertEqual(code, 0)
        self.assertIn("no changes", out)
        self.assertEqual(self.backups(), [])

    def test_refused_keys_stop_everything(self):
        for key in ("YAROPAY_ENCRYPTION_KEY", "POSTGRES_PASSWORD", "POSTGRES_USER", "POSTGRES_DB", "API_IMAGE", "WEB_IMAGE"):
            code, out, err = self.run_script('{"LOG_LEVEL": "debug", "%s": "x"}' % key)
            self.assertEqual(code, 1, key)
            self.assertIn(key, err)
            self.assertIn("README", err)
        self.assertEqual(Path(self.path).read_text(), ORIGINAL)

    def test_previous_encryption_key_is_allowed(self):
        code, _, _ = self.run_script('{"YAROPAY_ENCRYPTION_KEY_PREVIOUS": "old-key"}')
        self.assertEqual(code, 0)
        self.assertIn("YAROPAY_ENCRYPTION_KEY_PREVIOUS=old-key", Path(self.path).read_text())

    def test_bad_names_and_values_are_refused(self):
        for payload in ('{"lower": "x"}', '{"1ABC": "x"}', '{"A-B": "x"}', '{"A": "two\\nlines"}', '{"A": 5}', '["A"]', "not json"):
            code, _, err = self.run_script(payload)
            self.assertEqual(code, 1, payload)
            self.assertNotIn("two", err.replace("two\\n", ""), "values never printed")
        self.assertEqual(Path(self.path).read_text(), ORIGINAL)

    def test_quoting(self):
        self.run_script('{"A": "plain-value_1.2:3@x/y", "B": "has space", "C": "p$ss#word"}')
        text = Path(self.path).read_text()
        self.assertIn("A=plain-value_1.2:3@x/y\n", text)
        self.assertIn("B='has space'\n", text)
        self.assertIn("C='p$ss#word'\n", text)
        code, _, err = self.run_script('{"D": "it\'s $pecial"}')
        self.assertEqual(code, 1)
        self.assertIn("single quote", err)

    def test_duplicates_of_a_set_key_collapse_to_one(self):
        Path(self.path).write_text("LOG_LEVEL=log\nOTHER=1\nLOG_LEVEL=warn\n")
        self.run_script('{"LOG_LEVEL": "debug"}')
        self.assertEqual(Path(self.path).read_text(), "LOG_LEVEL=debug\nOTHER=1\n")

    def test_file_without_trailing_newline(self):
        Path(self.path).write_text("A=1")
        self.run_script('{"B": "2"}')
        self.assertEqual(Path(self.path).read_text(), "A=1\nB=2\n")


if __name__ == "__main__":
    unittest.main()
