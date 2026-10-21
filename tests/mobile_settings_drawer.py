"""Settings drawer (UISettingsPatch.kt) on the desktop settings layout: grip and drawer at 390px and 800px, Android Back
through the native back script closes the drawer first and then leaves the page to the app, no Donate footer, and no
grip/drawer while the phone settings screen ([data-phone-screen="settings"]) is mounted."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, re
root=Path(__file__).resolve().parents[1]
checks=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name

KT=root/'app/src/main/java/com/seanime/app'
PATCH_JS=[part for i,part in enumerate((KT/'UISettingsPatch.kt').read_text(encoding='utf-8').split('"""')) if i%2==1]
assert len(PATCH_JS)==2 and not re.search(r'\$\{|\$[A-Za-z_]',''.join(PATCH_JS)),'patch JS must be two plain Kotlin raw strings'
NATIVE_BACK=(KT/'AndroidNavigation.kt').read_text(encoding='utf-8').split('"""')[1].strip()

ICON='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>'
def trigger(i,label,active=False):
    return f'<button class="UI-Tabs__trigger" id="tab-{i}" data-state="{"active" if active else "inactive"}" onclick="window.__picked=\'{label}\'">{ICON}{label}</button>'
DESKTOP=('<main><div class="overflow-x-none overflow-y-hidden"><div class="UI-Card__root">'+trigger(1,'Seanime',True)+trigger(2,'Library')+
    '</div><div class="UI-Card__root">'+trigger(3,'Anime Library')+trigger(4,'Torrent')+'</div></div>'
    '<div class="content"><button class="UI-Button_root">Donate</button><p>Settings content</p></div></main>')

def run_patch(page):
    for js in PATCH_JS: page.evaluate(js)
def tab_box(page):
    return page.evaluate("""() => { var t=document.getElementById('__seanime_drawer_tab'); if(!t) return null;
        var r=t.getBoundingClientRect(); var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
        return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height, reachable: hit===t || t.contains(hit)}; }""")
def drawer_open(page):
    return page.evaluate("() => { var d=document.getElementById('__seanime_drawer'); return !!d && d.style.transform==='translateX(0px)'; }")

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    for w,h in ((390,844),(800,1280)):
        page=browser.new_page(viewport=dict(width=w,height=h),has_touch=True)
        page.route('http://settings.test/**',lambda r: r.fulfill(status=200,content_type='text/html',
            body='<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#000"></body></html>'))
        page.goto('http://settings.test/settings')
        page.evaluate('html => document.body.innerHTML = html',DESKTOP)
        run_patch(page)
        page.wait_for_timeout(100)
        box=tab_box(page)
        check(f'{w}px: grip appears and is reachable',box and box['reachable'] and round(box['w'])==20 and round(box['h'])==56)
        page.touchscreen.tap(box['x'],box['y']);page.wait_for_timeout(350)
        check(f'{w}px: tapping the grip opens the drawer',drawer_open(page))
        labels=page.evaluate("() => Array.from(document.querySelectorAll('#__seanime_drawer [data-drawer-for]')).map(b => b.textContent.trim())")
        check(f'{w}px: drawer lists every settings tab',labels==['Seanime','Library','Anime Library','Torrent'])
        check(f'{w}px: drawer has no Donate footer',
            'Donate' not in page.evaluate("() => document.getElementById('__seanime_drawer').textContent"))
        check(f'{w}px: page Donate button stays hidden',
            page.evaluate("() => getComputedStyle(document.querySelector('.content .UI-Button_root')).display")=='none')
        handled=page.evaluate(NATIVE_BACK);page.wait_for_timeout(350)
        check(f'{w}px: Back closes the open drawer and reports handled',handled is True and not drawer_open(page))
        check(f'{w}px: a second Back is left to the app',page.evaluate(NATIVE_BACK) is False and not drawer_open(page))
        # Reopen, then pick a tab: the real trigger is clicked and the drawer stays usable.
        box=tab_box(page);page.touchscreen.tap(box['x'],box['y']);page.wait_for_timeout(350)
        page.click('#__seanime_drawer [data-drawer-for="tab-3"]')
        check(f'{w}px: drawer item forwards to the real tab',page.evaluate('window.__picked')=='Anime Library')
        # Phone settings screen mounts: an existing (open) drawer and grip are removed, Back no longer sees the drawer.
        page.evaluate("() => { var d=document.createElement('div'); d.setAttribute('data-phone-screen','settings'); document.body.appendChild(d); }")
        page.wait_for_timeout(150)
        gone=page.evaluate("() => ['__seanime_drawer','__seanime_backdrop','__seanime_drawer_tab'].every(id => !document.getElementById(id))")
        check(f'{w}px: phone settings screen removes an existing drawer and grip',gone)
        check(f'{w}px: Back after removal is left to the app',page.evaluate(NATIVE_BACK) is False)
        page.evaluate("() => document.querySelector('.content').appendChild(document.createElement('span'))");page.wait_for_timeout(150)
        check(f'{w}px: DOM changes do not rebuild the drawer on the phone screen',tab_box(page) is None)
        page.close()
        # Fresh page that already shows the phone settings screen: the patch never builds a grip.
        page=browser.new_page(viewport=dict(width=w,height=h),has_touch=True)
        page.route('http://settings.test/**',lambda r: r.fulfill(status=200,content_type='text/html',body='<!doctype html><html><body></body></html>'))
        page.goto('http://settings.test/settings')
        page.evaluate('html => document.body.innerHTML = html',DESKTOP+'<div data-phone-screen="settings"></div>')
        run_patch(page);page.wait_for_timeout(150)
        check(f'{w}px: no grip or drawer while the phone settings screen is shown',
            page.evaluate("() => !document.getElementById('__seanime_drawer_tab') && !document.getElementById('__seanime_drawer')"))
        page.close()
    browser.close()
print(json.dumps(checks,indent=2))
