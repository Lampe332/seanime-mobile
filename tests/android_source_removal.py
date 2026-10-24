"""Audit source removal and the exact native web bundle shipped in an Android APK."""
from pathlib import Path
import hashlib
import re
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
kotlin = root / "app/src/main/java/com/seanime/app"
assert not (kotlin / "UIHosterPlayerPatch.kt").exists()
assert "UIHosterPlayerPatch" not in (kotlin / "UIPatches.kt").read_text(encoding="utf-8")
nav = (kotlin / "UIBottomNav.kt").read_text(encoding="utf-8")
for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", nav):
    if "float-nav-tooltip" in selector or "button span" in selector:
        assert not re.search(r"(?:background(?:-image)?|border(?:-radius)?|box-shadow|backdrop-filter)\s*:", declarations), selector
removed = ("Enable offline mode", "Select media to save", "No tracked media", "Auto-refresh offline media", "ensureLauncher", "updateVisibility", "hpLauncher")
for file in (root / "backend/web").rglob("*.js"):
    source = file.read_text(encoding="utf-8")
    assert not any(term in source for term in removed), file
assert not (root / "backend/seanime-web/src/app/(main)/sync").exists()
assert 'to="/android-downloads" replace' in (root / "backend/seanime-web/src/mobile/legacy-sync-redirect.tsx").read_text(encoding="utf-8")
for file in (root / "app/src/main/jniLibs").glob("*/libseanime.so"):
    data = file.read_bytes()
    assert not any(term.encode() in data for term in removed), file
    assert b"legacyMobileHoster" in data or b"hp-stage" in data, "corrected player source not embedded"
    if len(sys.argv) > 1:
        with zipfile.ZipFile(sys.argv[1]) as apk:
            entry = "lib/" + file.parent.name + "/libseanime.so"
            assert apk.read(entry) == data, "APK contains stale backend: " + entry
            for name in apk.namelist():
                if name.endswith(".dex"):
                    assert b"UIHosterPlayerPatch" not in apk.read(name), "old DOM patch still packaged"
    print("PASS:", file.parent.name, hashlib.sha256(data).hexdigest())
print("PASS: text paint declarations and launcher patch removed; old sync UI absent from Android web/native payload and source")
