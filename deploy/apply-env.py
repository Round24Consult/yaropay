#!/usr/bin/env python3
"""Merges server settings from GitHub into the hosted edition's .env.

The Deploy workflow sends a JSON object on stdin: every GitHub secret or variable named ENV_<KEY>,
with the ENV_ prefix removed (a secret wins over a variable of the same name). This script:

- keeps every line of .env it isn't told to change (comments, order and other keys stay as they are),
- replaces or adds the keys it was given,
- backs the old file up as .env.bak-<UTC time> (mode 0600, the last 5 are kept),
- writes the new file with the old file's owner and mode, then swaps it in atomically.

It prints key names only, never values. Keys that must not change this way are refused, and the
deploy stops before anything restarts. Usage: python3 apply-env.py /opt/yaropay/.env < settings.json
"""
import json
import os
import re
import shutil
import sys
import tempfile
import time

KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")
LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
# Values Compose reads literally without quotes. Anything else is single-quoted, which Compose also
# takes literally (no ${...} substitution, no escapes).
PLAIN = re.compile(r"^[A-Za-z0-9_./:@%+=,~-]*$")
KEEP_BACKUPS = 5
DOCS = "see 'Changing server settings from GitHub' in the README"

REFUSED = {
    "YAROPAY_ENCRYPTION_KEY": "it encrypts every saved gateway key and secret; changing it here would make them unreadable. "
    "Rotate it with the documented procedure (YAROPAY_ENCRYPTION_KEY_PREVIOUS can be set from GitHub for that)",
    "POSTGRES_PASSWORD": "Postgres only reads it when the database is first created; changing it here breaks the API's connection",
    "POSTGRES_USER": "Postgres only reads it when the database is first created; changing it here breaks the API's connection",
    "POSTGRES_DB": "Postgres only reads it when the database is first created; changing it here breaks the API's connection",
    "API_IMAGE": "the deploy sets it to the image it just built",
    "WEB_IMAGE": "the deploy sets it to the image it just built",
}


class Refused(Exception):
    pass


def render(key: str, value: str) -> str:
    if PLAIN.match(value):
        return f"{key}={value}"
    if "'" in value:
        raise Refused(f"{key}: the value has a single quote and other special characters, which .env can't hold safely; set it on the server")
    return f"{key}='{value}'"


def validate(settings: object) -> dict[str, str]:
    if not isinstance(settings, dict):
        raise Refused("expected a JSON object of settings")
    clean: dict[str, str] = {}
    for key, value in settings.items():
        if not isinstance(key, str) or not KEY.match(key):
            raise Refused(f"{key!r} isn't a valid setting name (capital letters, digits and _, starting with a letter)")
        if key in REFUSED:
            raise Refused(f"{key} can't be changed from GitHub: {REFUSED[key]} ({DOCS})")
        if not isinstance(value, str):
            raise Refused(f"{key}: the value must be text")
        if any(c in value for c in "\n\r\0"):
            raise Refused(f"{key}: the value has more than one line, which .env can't hold")
        clean[key] = value
    return clean


def merge(lines: list[str], settings: dict[str, str]) -> tuple[list[str], list[str], list[str]]:
    """Returns the new lines and the names of the keys changed and added."""
    rendered = {k: render(k, v) for k, v in settings.items()}
    out: list[str] = []
    seen: set[str] = set()
    changed: list[str] = []
    for line in lines:
        m = LINE.match(line)
        key = m.group(1) if m else None
        if key in rendered:
            if key in seen:
                continue  # a duplicate of a key being set: drop it so only the new value remains
            seen.add(key)
            new = rendered[key] + "\n"
            if line.rstrip("\n") != rendered[key]:
                changed.append(key)
            out.append(new)
        else:
            out.append(line)
    added = [k for k in settings if k not in seen]
    if added:
        if out and not out[-1].endswith("\n"):
            out[-1] += "\n"
        out.extend(rendered[k] + "\n" for k in added)
    return out, changed, added


def write(path: str, lines: list[str]) -> str:
    st = os.stat(path)
    directory = os.path.dirname(os.path.abspath(path))
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup = f"{path}.bak-{stamp}"
    shutil.copyfile(path, backup)
    os.chmod(backup, 0o600)
    backups = sorted(f for f in os.listdir(directory) if f.startswith(os.path.basename(path) + ".bak-"))
    for old in backups[:-KEEP_BACKUPS]:
        os.remove(os.path.join(directory, old))

    fd, tmp = tempfile.mkstemp(prefix=".env.new-", dir=directory)
    try:
        with os.fdopen(fd, "w") as f:
            f.writelines(lines)
            f.flush()
            os.fsync(f.fileno())
        try:
            os.chown(tmp, st.st_uid, st.st_gid)
        except PermissionError:
            pass  # not root: the new file keeps this user's ownership, which is the file's owner here
        os.chmod(tmp, st.st_mode & 0o777)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return backup


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: apply-env.py /path/to/.env < settings.json", file=sys.stderr)
        return 2
    path = argv[1]
    raw = sys.stdin.read().strip()
    try:
        settings = validate(json.loads(raw) if raw else {})
    except (json.JSONDecodeError, Refused) as e:
        print(f"Server settings not applied: {e}", file=sys.stderr)
        return 1
    if not settings:
        print("No ENV_ settings on GitHub: .env unchanged.")
        return 0
    with open(path) as f:
        lines = f.readlines()
    try:
        new, changed, added = merge(lines, settings)
    except Refused as e:
        print(f"Server settings not applied: {e}", file=sys.stderr)
        return 1
    if not changed and not added:
        print(f"Server settings from GitHub already applied ({len(settings)}): no changes.")
        return 0
    backup = write(path, new)
    if changed:
        print("Changed: " + ", ".join(changed))
    if added:
        print("Added: " + ", ".join(added))
    print(f"Previous .env kept as {os.path.basename(backup)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
