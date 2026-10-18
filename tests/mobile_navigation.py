"""Regression checks for the Android-injected navigation. Run with Python + Playwright."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re,sys

ROOT=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
K=ROOT/'app/src/main/java/com/seanime/app'
back=re.search(r'val backScript = """(.*?)"""\.trimIndent',(K/'AndroidNavigation.kt').read_text(),re.S).group(1)
scripts=re.findall(r'val js = """(.*?)"""\.trimIndent\(\)',(K/'UIBottomNav.kt').read_text(encoding='utf-8'),re.S)
links=[('Home','/'),('Schedule','/schedule'),('Manga','/manga'),('My lists','/lists'),('Discover','/discover'),('Search','/search'),('Torrent list','/torrent-list'),('Download Notifier','/webview?id=test'),('Extensions','/extensions'),('Offline','/sync'),('Settings','/settings')]
html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}aside{display:none}</style></head><body><aside class="UI-AppSidebar__sidebar">'+''.join(f'<a href="{url}" data-vertical-menu-item-link="{name}">{name}</a>' for name,url in links)+'</aside><main data-main-layout-content="true"></main></body></html>'
results=[]
def record(name,condition,detail=None):
    results.append({'name':name,'pass':bool(condition),'detail':detail})

with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    for width,height in [(360,740),(412,883),(740,360)]:
        page=b.new_page(viewport={'width':width,'height':height},has_touch=True,is_mobile=True)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('http://navigation.test/**',lambda route:route.fulfill(body=html,content_type='text/html'))
        page.goto('http://navigation.test/')
        page.evaluate('''()=>document.querySelectorAll('aside a').forEach(a=>a.onclick=e=>{e.preventDefault();history.pushState({},'',a.getAttribute('href'))})''')
        for script in scripts: page.evaluate(script.replace("${'$'}",'$'))
        page.wait_for_timeout(100)
        nav=page.locator('#__seanime_bottom_nav');menu=nav.locator('button')
        prefix=f'{width}x{height}: '
        record(prefix+'home marked',nav.locator('a[aria-current="page"]').count()==1)
        nav.locator('a[href="/search"]').click();page.wait_for_timeout(150)
        record(prefix+'SPA tab updates',nav.locator('a[href="/search"]').get_attribute('aria-current')=='page' and page.url.endswith('/search'))
        menu.click();page.wait_for_timeout(800)
        box=page.locator('#android-floating-menu').bounding_box()
        record(prefix+'menu fits viewport',box['y']>=0 and box['y']+box['height']<=height,box)
        menu.click();menu.click();page.wait_for_timeout(700)
        record(prefix+'rapid reopen stays visible',page.locator('#android-floating-menu').is_visible())
        if not page.locator('#android-floating-menu').is_visible(): menu.click();menu.click();page.wait_for_timeout(600)
        if page.locator('#android-floating-menu').is_visible():
            # Every row remains reachable by scrolling, including long menus.
            reachable=True
            for row in page.locator('#android-floating-menu .float-nav-item').all():
                row.scroll_into_view_if_needed();r=row.bounding_box()
                reachable=reachable and r['y']>=-1 and r['y']+r['height']<=height+1
            record(prefix+'all menu rows reachable',reachable)
            page.locator('#__seanime_reset_btn').click();page.wait_for_timeout(220)
            record(prefix+'reset Back handled',page.evaluate(back))
            record(prefix+'reset closed before menu',not page.locator('#__seanime_reset_dialog_overlay').evaluate('e=>e.classList.contains("visible")') and menu.get_attribute('data-menu-open')=='true')
            # Dismiss any baseline reset and reopen its menu if the old Back closed it.
            page.locator('#__seanime_reset_dialog_overlay').evaluate('e=>e.classList.remove("visible")')
            if menu.get_attribute('data-menu-open')!='true': menu.click();page.wait_for_timeout(700)
            page.locator('#__seanime_wrench_btn').click()
            handled=page.evaluate(back)
            record(prefix+'edit Back stays on page',handled and not nav.evaluate('e=>e.classList.contains("seanime-edit-mode")'))
            # Edit mode: add instead of swap, 7-entry cap, give back, persistence.
            ids=lambda:nav.locator('[data-nav-id]').evaluate_all('els=>els.map(e=>e.getAttribute("data-nav-id"))')
            menu.click();page.wait_for_timeout(700)
            page.locator('#__seanime_wrench_btn').click();page.wait_for_timeout(300)
            panel=page.locator('#android-floating-menu')
            count=page.locator('#__seanime_edit_count')
            record(prefix+'edit panel header',page.locator('#__seanime_edit_done_btn').count()==1 and 'In der Leiste: 6/7' in count.inner_text() and page.locator('.seanime-edit-sec-title').count()==2)
            record(prefix+'edit panel SVG grips',page.locator('#android-floating-menu .float-drag-handle svg').count()>0 and '⣿' not in panel.inner_text())
            before=ids()
            panel.locator('.float-nav-item[data-section="menu"][data-float-label="Schedule"]').click();page.wait_for_timeout(200)
            after=ids()
            record(prefix+'tap adds entry (7, nothing dropped)',len(after)==7 and all(i in after for i in before) and 'In der Leiste: 7/7' in count.inner_text(),after)
            panel.locator('.float-nav-item[data-section="menu"][data-float-label="Manga"]').click();page.wait_for_timeout(200)
            record(prefix+'full bar refuses with notice',ids()==after and 'voll' in count.inner_text())
            record(prefix+'no duplicate My lists in menu',panel.locator('.float-nav-item[data-section="menu"][data-float-label="My lists"]').count()==0)
            page.locator('#__seanime_edit_done_btn').click();page.wait_for_timeout(200)
            page.reload();page.evaluate('''()=>document.querySelectorAll('aside a').forEach(a=>a.onclick=e=>{e.preventDefault();history.pushState({},'',a.getAttribute('href'))})''')
            for script in scripts: page.evaluate(script.replace("${'$'}",'$'))
            page.wait_for_timeout(200)
            record(prefix+'7 entries persist after reload',ids()==after and nav.get_attribute('data-nav-count')=='7',ids())
            menu.click();page.wait_for_timeout(700)
            page.locator('#__seanime_wrench_btn').click();page.wait_for_timeout(300)
            panel.locator('.float-nav-item[data-section="bar"][data-nav-id="__float_Schedule"]').click();page.wait_for_timeout(200)
            record(prefix+'tap gives entry back to menu',len(ids())==6 and panel.locator('.float-nav-item[data-section="menu"][data-float-label="Schedule"]').count()==1)
            panel.locator('.float-nav-item[data-section="bar"][data-nav-id="menu"]').click();page.wait_for_timeout(100)
            record(prefix+'Menu button cannot leave bar',nav.locator('button[data-nav-id="menu"]').count()==1 and len(ids())==6)
            page.locator('#__seanime_edit_done_btn').click()
            # Reset returns the same baseline as first launch, including the Android Downloads tab,
            # and must leave unrelated app storage alone.
            page.evaluate("localStorage.setItem('__mobile_navigation_test_sentinel', 'keep')")
            if menu.get_attribute('data-menu-open')!='true': menu.click();page.wait_for_timeout(700)
            page.locator('#__seanime_reset_btn').click();page.wait_for_timeout(150)
            page.locator('#__seanime_reset_dialog_actions button').nth(1).click();page.wait_for_timeout(200)
            record(prefix+'reset restores default tabs',ids()==['home','lists','discover','search','menu','android-downloads'],ids())
            record(prefix+'reset leaves unrelated storage',page.evaluate("localStorage.getItem('__mobile_navigation_test_sentinel')")=='keep')
        record(prefix+'no JavaScript errors',not errors,errors)
        page.close()
    b.close()
print(json.dumps(results,indent=2))
sys.exit(0 if all(r['pass'] for r in results) else 1)
