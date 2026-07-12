"""Fixture tests for verify_rom (P0-V1) — the moat's acceptance.

Requires libmgba (run inside the toolchain image) and the built P0-FX1
fixtures. From the repo root, inside the image:
    pytest verify_rom/test_verify_rom.py -q
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from verify_rom import verify, pc_valid, sp_valid  # noqa: E402

_FIX = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def test_known_good_passes():
    r = verify(os.path.join(_FIX, "known-good", "known-good.gba"), frames=300)
    assert r["pass"] is True, r["gameErrors"]
    assert r["gameErrors"] == []
    assert pc_valid(r["cpu"]["pc"]) and sp_valid(r["cpu"]["sp"])


def test_known_bad_oam_fails_with_class_a():
    r = verify(os.path.join(_FIX, "known-bad-oam", "known-bad-oam.gba"), frames=300)
    assert r["pass"] is False
    assert any("Store8 to OAM" in e for e in r["gameErrors"]), r["gameErrors"]


def test_ranges_pure_logic():
    # Runs even without libmgba.
    assert pc_valid(0x000001F8) and pc_valid(0x08000000)
    assert not pc_valid(0x01000000) and not pc_valid(0x10000000)
    assert sp_valid(0x03007E7C) and not sp_valid(0x08000000)
