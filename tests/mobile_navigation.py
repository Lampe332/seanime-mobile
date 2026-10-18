"""Regression checks for the Android-injected navigation. Run with Python + Playwright."""
from mobile_icon_source import icon_script
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re,sys

ROOT=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
K=ROOT/'app/src/main/java/com/seanime/app'
back=re.search(r'val backScript = """(.*?)"""\.trimIndent',(K/'AndroidNavigation.kt').read_text(),re.S).group(1)
scripts=re.findall(r'val js = """(.*?)"""\.trimIndent\(\)',(K/'UIBottomNav.kt').read_text(encoding='utf-8'),re.S)
links=[('Home','/'),('Schedule','/schedule'),('Manga','/manga'),('My lists','/lists'),('Discover','/discover'),('Search','/search'),('Torrent list','/torrent-list'),('Download Notifier','/webview?id=test'),('Extensions','/extensions'),('Offline-Synchronisierung','/sync?from=legacy'),('Settings','/settings')]
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
        page.evaluate('''() => {
            const items = [
                {id:'home',href:'/',label:'Home',placement:'nav'},
                {id:'lists',href:'/lists',label:'My Lists',placement:'nav'},
                {id:'discover',href:'/discover',label:'Discover',placement:'nav'},
                {id:'search',href:'/search',label:'Search',placement:'nav'},
                {id:'menu',label:'Menu',placement:'nav',isMenu:true,immovableToFloat:true},
                {id:'android-downloads',href:'/android-downloads',label:'Downloads',placement:'nav'},
                {id:'__float_Synchronisation',href:'/sync?from=legacy',label:'Synchronisation',placement:'nav',isSidebarItem:true},
                {id:'__float_Settings',href:'/settings',label:'Settings',placement:'float',isSidebarItem:true}
            ];
            localStorage.setItem('__seanime_nav_items_full', JSON.stringify(items));
            localStorage.setItem('__seanime_nav_order', JSON.stringify(items.map(item => item.id)));
            localStorage.setItem('__seanime_nav_placement', JSON.stringify(Object.fromEntries(items.map(item => [item.id, item.placement]))));
            localStorage.setItem('__seanime_float_order', JSON.stringify(['Synchronisation','Settings']));
            localStorage.setItem('__seanime_float_hidden', JSON.stringify({Synchronisation:true,'Keep hidden':true}));
            const video = document.createElement('video');
            video.id = 'episode-player';
            document.body.appendChild(video);
        }''')
        page.evaluate('''()=>document.querySelectorAll('aside a').forEach(a=>a.onclick=e=>{e.preventDefault();history.pushState({},'',a.getAttribute('href'))})''')
        page.evaluate(icon_script)
        for script in scripts: page.evaluate(script.replace("${'$'}",'$'))
        page.wait_for_timeout(100)
        nav=page.locator('#__seanime_bottom_nav');menu=nav.locator('button')
        prefix=f'{width}x{height}: '
        ids=lambda:nav.locator('[data-nav-id]').evaluate_all('els=>els.map(e=>e.getAttribute("data-nav-id"))')
        migrated=page.evaluate('''() => ({
            items: JSON.parse(localStorage.getItem('__seanime_nav_items_full') || '[]'),
            order: JSON.parse(localStorage.getItem('__seanime_nav_order') || '[]'),
            placement: JSON.parse(localStorage.getItem('__seanime_nav_placement') || '{}'),
            floatOrder: JSON.parse(localStorage.getItem('__seanime_float_order') || '[]'),
            hidden: JSON.parse(localStorage.getItem('__seanime_float_hidden') || '{}')
        })''')
        record(prefix+'legacy /sync config removed by destination',all(item.get('href')!='/sync?from=legacy' for item in migrated['items']) and '__float_Synchronisation' not in migrated['order'] and '__float_Synchronisation' not in migrated['placement'],migrated)
        record(prefix+'other order, placement and float settings preserved',migrated['order']==['home','lists','discover','search','menu','android-downloads','__float_Settings'] and migrated['placement'].get('__float_Settings')=='float' and migrated['floatOrder']==['Settings'] and migrated['hidden']=={'Keep hidden':True},migrated)

        record(prefix+'Downloads retained once at original end position',ids()==['home','lists','discover','search','menu','android-downloads'] and nav.locator('[data-nav-id="android-downloads"]').count()==1,ids())
        record(prefix+'home marked',nav.locator('a[aria-current="page"]').count()==1)
        nav.locator('a[href="/search"]').click();page.wait_for_timeout(150)
        record(prefix+'SPA tab updates',nav.locator('a[href="/search"]').get_attribute('aria-current')=='page' and page.url.endswith('/search'))
        bar_style=nav.locator('a[href="/search"] span').evaluate('''e=>({label:getComputedStyle(e).backgroundColor,tab:getComputedStyle(e.parentElement).backgroundColor})''')
        record(prefix+'bottom label has no chip and active tab stays purple',bar_style['label']=='rgba(0, 0, 0, 0)' and bar_style['tab']!='rgba(0, 0, 0, 0)',bar_style)
        page.evaluate("history.pushState({},'', '/entry?id=21')")
        page.wait_for_timeout(120)
        menu.click();page.wait_for_timeout(800)
        box=page.locator('#android-floating-menu').bounding_box()
        record(prefix+'menu fits viewport',box['y']>=0 and box['y']+box['height']<=height,box)
        record(prefix+'sync target absent from menu snapshot',page.locator('#android-floating-menu .float-nav-item[aria-label="Offline-Synchronisierung"]').count()==0)
        label_style=page.locator('#android-floating-menu .float-nav-tooltip').first.evaluate('''e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,border:s.borderWidth,radius:s.borderRadius,shadow:s.boxShadow,filter:s.backdropFilter}}''')
        record(prefix+'menu text has no chip background',label_style['background']=='rgba(0, 0, 0, 0)' and label_style['border']=='0px' and label_style['radius']=='0px' and label_style['shadow']=='none' and label_style['filter']=='none',label_style)
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
            menu.click();page.wait_for_timeout(700)
            page.locator('#__seanime_wrench_btn').click();page.wait_for_timeout(300)
            panel=page.locator('#android-floating-menu')
            count=page.locator('#__seanime_edit_count')
            record(prefix+'edit panel header',page.locator('#__seanime_edit_done_btn').count()==1 and 'In der Leiste: 6/7' in count.inner_text() and page.locator('.seanime-edit-sec-title').count()==2)
            record(prefix+'edit view preserves Settings and excludes /sync',panel.locator('.float-nav-item[data-section="menu"][data-float-label="Settings"]').count()==1 and panel.locator('.float-nav-item[data-float-label="Offline-Synchronisierung"], .float-nav-item[data-float-label="Synchronisation"]').count()==0)
            edit_label_style=panel.locator('.float-nav-tooltip').first.evaluate('''e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,radius:s.borderRadius,shadow:s.boxShadow,filter:s.backdropFilter}}''')
            record(prefix+'customization text has no chip background',edit_label_style['background']=='rgba(0, 0, 0, 0)' and edit_label_style['radius']=='0px' and edit_label_style['shadow']=='none' and edit_label_style['filter']=='none',edit_label_style)
            record(prefix+'edit panel SVG grips',page.locator('#android-floating-menu .float-drag-handle svg').count()>0 and '⣿' not in panel.inner_text())
            before=ids()
            panel.locator('.float-nav-item[data-section="menu"][data-float-label="Schedule"]').click();page.wait_for_timeout(200)
            after=ids()
            record(prefix+'tap adds entry (7, nothing dropped)',len(after)==7 and all(i in after for i in before) and 'In der Leiste: 7/7' in count.inner_text(),after)
            panel.locator('.float-nav-item[data-section="menu"][data-float-label="Manga"]').click();page.wait_for_timeout(200)
            record(prefix+'full bar refuses with notice',ids()==after and 'voll' in count.inner_text())
            record(prefix+'no duplicate My lists in menu',panel.locator('.float-nav-item[data-section="menu"][data-float-label="My lists"]').count()==0)
            page.locator('#__seanime_edit_done_btn').click();page.wait_for_timeout(200)
            page.reload();page.evaluate('''() => {
                document.querySelectorAll('aside a').forEach(a=>a.onclick=e=>{e.preventDefault();history.pushState({},'',a.getAttribute('href'))});
            }''')
            page.evaluate(icon_script)
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
            record(prefix+'reset restores default tabs once',ids()==['home','lists','discover','search','menu','android-downloads'] and nav.locator('[data-nav-id="android-downloads"]').count()==1 and nav.locator('a[href^="/sync"]').count()==0,ids())
            record(prefix+'reset leaves unrelated storage',page.evaluate("localStorage.getItem('__mobile_navigation_test_sentinel')")=='keep')
            if menu.get_attribute('data-menu-open')!='true': menu.click();page.wait_for_timeout(700)
            record(prefix+'sync item stays out after reset and recollection',page.locator('#android-floating-menu .float-nav-item[aria-label="Offline-Synchronisierung"]').count()==0 and page.locator('#android-floating-menu .float-nav-item[aria-label="Synchronisation"]').count()==0)
        record(prefix+'no JavaScript errors',not errors,errors)
        page.close()
    b.close()
print(json.dumps(results,indent=2))
sys.exit(0 if all(r['pass'] for r in results) else 1)
