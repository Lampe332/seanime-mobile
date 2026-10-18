from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
source = (root / "app/src/main/java/com/seanime/app/MobileIcons.kt").read_text(encoding="utf-8")
icon_script = re.search(r'view.evaluateJavascript\("""(.*?)""".trimIndent', source, re.S).group(1)
icon_script = icon_script.replace("$definitions", (root/"backend/seanime-web/src/lib/mobile-icons/icons.json").read_text(encoding="utf-8"))
