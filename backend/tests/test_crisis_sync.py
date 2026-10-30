"""The on-device check (shared/src/crisis.ts) is generated from app/crisis_patterns.py."""

import subprocess
import sys
from pathlib import Path

import pytest

from app import crisis_patterns as P

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sync_crisis_ts.py"


def test_crisis_ts_is_in_sync():
    r = subprocess.run([sys.executable, str(SCRIPT), "--check"])
    assert r.returncode == 0, "shared/src/crisis.ts is stale — run: cd backend && python scripts/sync_crisis_ts.py"


@pytest.mark.parametrize("src", P.IDIOMS + P.HIGH + P.CONCERN)
def test_patterns_are_portable_to_javascript(src):
    # No Python-only syntax: named groups, inline flags, possessive quantifiers, atomic groups.
    for bad in ("(?P<", "(?i", "(?>", "*+", "++", "?+"):
        assert bad not in src, (bad, src)
