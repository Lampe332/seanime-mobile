"""Built web UI the harnesses load their CSS and static files from: a local `npm run build` (out/) when there is one,
otherwise the bundle committed in backend/web."""
from pathlib import Path

_root = Path(__file__).resolve().parents[1]
WEB = next(p for p in (_root/'backend/seanime-web/out', _root/'backend/web') if (p/'static/css').is_dir())
