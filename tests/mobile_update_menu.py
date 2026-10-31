"""Full mobile update click path: actual React update panel + Android menu injector."""
from mobile_icon_source import icon_script
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app" / "src" / "main" / "java" / "com" / "seanime" / "app"
web = ROOT / "backend" / "seanime-web"
nav_source = (APP / "UIBottomNav.kt").read_text(encoding="utf-8")
scripts = re.findall(r'val js = """(.*?)"""\.trimIndent\(\)', nav_source, re.S)
assert scripts, "Could not find the Android bottom navigation injector"
back_script = re.search(r'val backScript = """(.*?)"""\.trimIndent', (APP / "AndroidNavigation.kt").read_text(encoding="utf-8"), re.S).group(1)
html = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;color:#eee;background:#09090f;font:16px sans-serif}
.UI-AppSidebar__sidebar{display:none}#update-react-root{display:none}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
<aside class="UI-AppSidebar__sidebar"></aside><main data-main-layout-content="true"></main><div id="update-react-root"></div>
</body></html>'''

def wait_for_request(page, baseline):
    page.wait_for_function("n => window.__appUpdateCheckCount > n && window.__pendingUpdateChecks.length > 0", arg=baseline)
    return page.evaluate("window.__pendingUpdateChecks[0]")

def respond(page, update):
    page.evaluate("update => window.__respondNextUpdate(update)", update)

def respond_error(page, message):
    page.evaluate("message => window.__respondNextError(message)", message)

with tempfile.TemporaryDirectory(prefix="seanime-mobile-update-test-") as temp_dir:
    bundle = Path(temp_dir) / "mobile-update-menu.js"
    subprocess.run(["node", str(ROOT / "tests" / "mobile_update_menu_bundle.cjs"), str(bundle)], check=True, cwd=ROOT)
    results = []

    def record(name, condition, detail=None):
        results.append({"name": name, "pass": bool(condition), "detail": detail})

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 412, "height": 883}, has_touch=True, is_mobile=True)
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("http://update.test/**", lambda route: route.fulfill(body=html, content_type="text/html"))
        page.goto("http://update.test/")
        page.evaluate('''() => {
            window.__appLanguage = "de";
            window.__appUpdateCheckCount = 0;
            window.__pendingUpdateChecks = [];
            window.__updateRequestHistory = [];
            window.AppUpdater = {
                checkForUpdates(requestId) {
                    window.__appUpdateCheckCount++;
                    window.__updateRequestHistory.push(requestId);
                    window.__pendingUpdateChecks.push(requestId);
                },
                getKnownUpdate() { return JSON.stringify({type:"app",current_version:"1.9.1"}); },
                getDownloadState() { return JSON.stringify({status:"idle"}); },
            };
            window.__respondNextUpdate = update => {
                const requestId = window.__pendingUpdateChecks.shift();
                if (!requestId) throw new Error("No pending controlled update check");
                window.dispatchEvent(new CustomEvent("seanime-app-update", {detail:{requestId, update}}));
            };
            window.__respondNextError = error => {
                const requestId = window.__pendingUpdateChecks.shift();
                if (!requestId) throw new Error("No pending controlled update check");
                window.dispatchEvent(new CustomEvent("seanime-app-update", {detail:{requestId, error}}));
            };
            window.__dispatchStaleUpdate = (requestId, update) =>
                window.dispatchEvent(new CustomEvent("seanime-app-update", {detail:{requestId, update}}));

            const items = [
                {id:"home",href:"/",label:"Home",placement:"nav"},
                {id:"lists",href:"/lists",label:"My Lists",placement:"nav"},
                {id:"discover",href:"/discover",label:"Discover",placement:"nav"},
                {id:"search",href:"/search",label:"Search",placement:"nav"},
                {id:"menu",label:"Menu",placement:"nav",isMenu:true,immovableToFloat:true},
                {id:"android-downloads",href:"/android-downloads",label:"Downloads",placement:"nav"},
            ];
            localStorage.setItem("__seanime_nav_items_full", JSON.stringify(items));
            localStorage.setItem("__seanime_nav_order", JSON.stringify(items.map(item => item.id)));
            localStorage.setItem("__seanime_nav_placement", JSON.stringify(Object.fromEntries(items.map(item => [item.id,item.placement]))));
            localStorage.setItem("__seanime_float_order", JSON.stringify([]));
            localStorage.setItem("__seanime_float_hidden", JSON.stringify({}));
            const sidebar = document.querySelector("aside");
            for (let i=0; i<22; i++) {
                const link = document.createElement("a");
                link.href = "/fixture-"+i;
                link.setAttribute("data-vertical-menu-item-link", "Fixture "+i);
                link.textContent = "Fixture "+i;
                sidebar.appendChild(link);
            }
        }''')
        page.evaluate(icon_script)
        for script in scripts:
            page.evaluate(script.replace("${'$'}", "$"))
        page.wait_for_selector('#__seanime_bottom_nav button[data-nav-id="menu"]')
        page.add_style_tag(path=str(bundle.with_suffix(".css")))
        page.add_script_tag(path=str(bundle))
        page.wait_for_selector('[data-app-update-sidebar] [role="status"]', state="attached")

        # Settle the component's automatic initial check with the same no-update result.
        page.wait_for_function("window.__pendingUpdateChecks.length === 1")
        respond(page, {"type":"app", "current_version":"1.9.1"})
        page.wait_for_function("window.__appUpdateCheckCount === 1 && !document.querySelector('[data-app-update-sidebar] [role=status]')?.textContent.includes('wird geprüft')")
        baseline = page.evaluate("window.__appUpdateCheckCount")

        menu_button = page.locator('#__seanime_bottom_nav button[data-nav-id="menu"]')
        menu_button.click()
        menu = page.locator("#android-floating-menu")
        menu.wait_for(state="visible")
        page.wait_for_selector("#android-floating-menu [data-app-update-panel] button")
        page.evaluate("document.querySelector('#android-floating-menu').scrollTop=32")
        before_scroll = page.evaluate("document.querySelector('#android-floating-menu').scrollTop")

        check_again = page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check')
        # A real tap: no scrolling first (the one-line panel sits partly above the scrolled menu)
        check_again.dispatch_event("click")
        first_request = wait_for_request(page, baseline)
        status = page.locator('#android-floating-menu [data-app-update-panel] [role="status"]')
        page.wait_for_function("document.querySelector('#android-floating-menu [data-app-update-panel] [role=status]')?.textContent.includes('wird geprüft')")
        evidence_dir = os.environ.get("SEANIME_UPDATE_TEST_EVIDENCE_DIR")
        if evidence_dir:
            evidence_path = Path(evidence_dir)
            evidence_path.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(evidence_path / "controlled-search-loading.png"), full_page=True)
        record("one click starts one controlled check", page.evaluate("window.__appUpdateCheckCount") == baseline + 1)
        record("menu and scroll position remain during the check", menu.is_visible() and page.evaluate("document.querySelector('#android-floating-menu').scrollTop") == before_scroll, {"before": before_scroll, "now": page.evaluate("document.querySelector('#android-floating-menu').scrollTop"), "visible": menu.is_visible()})
        record("German live status and animated spinner are visible", "wird geprüft" in status.inner_text() and page.locator('#android-floating-menu [data-update-check-spinner]').is_visible())
        record("manual action is disabled while the request is pending", page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check').is_disabled())
        page.locator('#android-floating-menu [data-app-update-panel] button').first.dispatch_event("click")
        page.locator('#android-floating-menu [data-app-update-panel] button').first.dispatch_event("click")
        record("rapid repeated taps do not create parallel checks", page.evaluate("window.__appUpdateCheckCount") == baseline + 1 and len(page.evaluate("window.__pendingUpdateChecks")) == 1)
        respond(page, {"type":"app", "current_version":"1.9.1"})
        page.wait_for_function("document.querySelector('#android-floating-menu [data-app-update-panel] [role=status]')?.textContent.includes('aktuell')")
        record("no-update result retains installed version and menu scroll", "App 1.9.1" in page.locator('#android-floating-menu [data-app-update-panel]').inner_text() and menu.is_visible() and page.evaluate("document.querySelector('#android-floating-menu').scrollTop") == before_scroll, {"before": before_scroll, "now": page.evaluate("document.querySelector('#android-floating-menu').scrollTop"), "text": page.locator('#android-floating-menu [data-app-update-panel]').inner_text()})

        # A network error is visible and leaves a retry action; the retry is another real bridge request.
        check_again = page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check')
        check_again.click()
        wait_for_request(page, baseline + 1)
        respond_error(page, "GitHub is unreachable")
        page.wait_for_function("document.querySelector('#android-floating-menu [data-app-update-panel] [role=status]')?.textContent.includes('Prüfung fehlgeschlagen')")
        record("network failure is understandable and retryable", page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check').is_enabled())
        retry = page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check')
        retry.click()
        retry_request = wait_for_request(page, baseline + 2)
        respond(page, {"type":"app", "current_version":"1.9.1"})
        page.wait_for_function("document.querySelector('#android-floating-menu [data-app-update-panel] [role=status]')?.textContent.includes('aktuell')")
        record("retry starts a fresh check and clears the prior error", retry_request is not None and page.evaluate("window.__appUpdateCheckCount") == baseline + 3)

        # Accelerate only the real native bridge timeout for this controlled UI scenario.
        page.evaluate('''() => {
            window.__originalSetTimeout = window.setTimeout;
            window.setTimeout = (callback, delay, ...args) =>
                window.__originalSetTimeout(callback, delay === 60000 ? 40 : delay, ...args);
        }''')
        page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check').click()
        wait_for_request(page, baseline + 3)
        page.wait_for_function("document.querySelector('#android-floating-menu [data-app-update-panel] [role=status]')?.textContent.includes('Prüfung fehlgeschlagen')")
        page.evaluate('''() => {
            window.setTimeout = window.__originalSetTimeout;
            delete window.__originalSetTimeout;
            window.__pendingUpdateChecks.shift();
        }''')
        timeout_retry = page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check')
        record("bridge timeout ends loading and leaves the menu retryable", timeout_retry.is_visible() and menu.is_visible() and not page.locator('#android-floating-menu [data-update-check-spinner]').is_visible())
        timeout_retry.click()
        timeout_retry_request = wait_for_request(page, baseline + 4)
        respond(page, {"type":"app", "current_version":"1.9.1"})
        page.wait_for_function("document.querySelector('#android-floating-menu [data-app-update-panel] [role=status]')?.textContent.includes('aktuell')")
        record("retry after timeout starts a fresh check and succeeds", timeout_retry_request is not None and page.evaluate("window.__appUpdateCheckCount") == baseline + 5)

        # If a late event from the previous request arrives during a newer query, the bridge ID is ignored.
        previous_id = page.evaluate("window.__updateRequestHistory[window.__updateRequestHistory.length-1]")
        page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check').click()
        current_id = wait_for_request(page, baseline + 5)
        page.evaluate("args => window.__dispatchStaleUpdate(args.id,args.update)", {"id":previous_id,"update":{"type":"app","current_version":"1.9.1","release":{"version":"9.9.9"}}})
        record("stale prior response cannot replace the active search", current_id != previous_id and "wird geprüft" in page.locator('#android-floating-menu [data-app-update-panel] [role="status"]').inner_text() and "9.9.9" not in page.locator('#android-floating-menu [data-app-update-panel]').inner_text())
        respond(page, {"type":"app", "current_version":"1.9.1"})
        page.wait_for_function("document.querySelector('#android-floating-menu [data-app-update-panel] [role=status]')?.textContent.includes('aktuell')")

        # Closing is user-controlled. Resolve while closed, then reopen and ensure shared state is restored.
        page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check').click()
        wait_for_request(page, baseline + 6)
        menu_button.click()
        page.wait_for_function("!document.querySelector('#android-floating-menu').classList.contains('visible') && getComputedStyle(document.querySelector('#android-floating-menu')).display === 'none'")
        respond(page, {"type":"app", "current_version":"1.9.1"})
        page.wait_for_timeout(50)
        menu_button.click()
        menu.wait_for(state="visible")
        page.wait_for_function("document.querySelector('#android-floating-menu [data-app-update-panel] [role=status]')?.textContent.includes('aktuell')")
        record("close during search is allowed and reopen restores the result", menu.is_visible() and "aktuell" in page.locator('#android-floating-menu [data-app-update-panel] [role=status]').inner_text())

        # Controlled newer release; this does not use or publish an APK.
        page.locator('#android-floating-menu [data-app-update-panel] button.mobile-update__check').click()
        wait_for_request(page, baseline + 7)
        respond(page, {"type":"app", "current_version":"1.9.1", "release":{"version":"1.9.2"}})
        page.wait_for_selector('#android-floating-menu [data-app-update-panel] .mobile-update__target:has-text("1.9.2")')
        record("newer version shows the release number and existing download action", "Herunterladen und aktualisieren" in page.locator('#android-floating-menu [data-app-update-panel]').inner_text() and menu.is_visible())

        record("Android Back still closes the menu", page.evaluate(back_script.replace("${'$'}", "$")) is True and not menu.is_visible())
        # Controlled presentation states only; these do not invoke an installer.
        menu_button.click()
        menu.wait_for(state="visible")
        page.evaluate("window.AppUpdater.getDownloadState = () => JSON.stringify(window.__presentationState || {status:'idle'})")
        states = [
            ({"status":"downloading","version":"1.9.2","bytes":25000000,"total":67000000}, "Wird heruntergeladen", True),
            ({"status":"downloading","version":"1.9.2","bytes":0,"message":"Waiting for network / Android download service"}, "Wird heruntergeladen", True),
            ({"status":"verifying","version":"1.9.2"}, "APK wird geprüft", True),
            ({"status":"preparing","version":"1.9.2"}, "Installation wird vorbereitet", True),
            ({"status":"permission","version":"1.9.2","verified":True}, "Installation aus dieser Quelle", False),
            ({"status":"confirmation","version":"1.9.2","verified":True}, "Android-Installationsbestätigung", False),
            ({"status":"installing","version":"1.9.2","verified":True}, "Installation angefordert", True),
            ({"status":"complete","version":"1.9.2"}, "APK geprüft", False),
            ({"status":"failed","version":"1.9.2","verified":True,"error":"Installation cancelled. You can retry the verified APK."}, "Update unterbrochen", False),
            ({"status":"error","error":"Download failed (Android 1006). Please retry."}, "Update unterbrochen", False),
        ]
        panel = page.locator('#android-floating-menu [data-app-update-panel]')
        for state, expected, disabled in states:
            page.evaluate("state => {window.__presentationState=state;document.dispatchEvent(new Event('visibilitychange'))}", state)
            page.wait_for_function("expected => document.querySelector('#android-floating-menu [role=status]')?.textContent.includes(expected)", arg=expected)
            record("presentation: " + state["status"], expected in panel.inner_text() and panel.locator('button').first.is_disabled() == disabled)
            record("menu/dialog share " + state["status"], panel.locator('[role=status]').inner_text() == page.locator('[data-update-dialog] [role=status]').inner_text())
            if state.get("total"):
                record("actual bytes and percent", panel.locator('progress').get_attribute('value') == '37' and '23,8 MB / 63,9 MB' in panel.inner_text())
            if evidence_dir:
                page.screenshot(path=str(evidence_path / ("presentation-" + state["status"] + ("-waiting" if "message" in state else "") + ".png")), full_page=True)
        page.emulate_media(reduced_motion="reduce")
        page.evaluate("window.__presentationState={status:'verifying'};document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_function("document.querySelector('#android-floating-menu [role=status]')?.textContent.includes('APK wird geprüft')")
        record("reduced motion stops spinner", panel.locator('.mobile-update__spinner').evaluate("e=>getComputedStyle(e).animationName") == "none")
        page.set_viewport_size({"width":320,"height":640})
        page.add_style_tag(content="html{font-size:32px}")
        page.evaluate("window.__presentationState={status:'failed',verified:true,error:'INSTALL_FAILED_ABORTED: '+ 'long-error-detail-'.repeat(20)};document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_function("document.querySelector('#android-floating-menu [role=status]')?.textContent.includes('Update unterbrochen')")
        record("320px and 200% text actions wrap", panel.evaluate("e=>e.scrollWidth<=e.clientWidth+1 && [...e.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44 && b.scrollWidth<=b.clientWidth+2)"))
        if evidence_dir:
            page.screenshot(path=str(evidence_path / 'presentation-small-large-text.png'), full_page=True)
        page.evaluate("window.__presentationState={status:'installed',version:'1.9.2'};window.AppUpdater.acknowledgeInstalledUpdate=()=>window.__ackCount=(window.__ackCount||0)+1;document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_function("document.querySelector('#android-floating-menu [role=status]')?.textContent.includes('Update erfolgreich installiert')")
        record("confirmed native installed fixture acknowledges once", page.evaluate("window.__ackCount") == 1)
        record("no JavaScript errors", not errors, errors)
        browser.close()

    print(json.dumps(results, indent=2, ensure_ascii=False))
    sys.exit(0 if all(result["pass"] for result in results) else 1)
