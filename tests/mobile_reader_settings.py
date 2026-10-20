"""Android manga reader settings sheet: grouped, segmented choices write the same stored settings, no desktop-only options. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
checks=[]
def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok),detail=detail));assert ok,(name,detail)
with tempfile.TemporaryDirectory(prefix='seanime-reader-settings-') as tmp:
    bundle=Path(tmp)/'reader.js'
    subprocess.run(['node',str(root/'tests/mobile_anime_bundle.cjs'),str(bundle),'mobile_reader_settings_harness.tsx','--no-stubs'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(w,h):
            page=browser.new_page(viewport=dict(width=w,height=h),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.route('http://anime.test/**',lambda r:r.fulfill(content_type='text/html',body='<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'))
            page.goto('http://anime.test/')
            for css in (root/'backend/seanime-web/out/static/css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator('#manga-reader-bar').wait_for()
            if w==360: bar_checks(page)
            page.get_by_role('button',name='Reader settings').click()
            sheet=page.locator('[data-mobile-reader-settings]');sheet.wait_for();page.wait_for_timeout(300)
            return page,sheet
        def bar_checks(page):
            styles=page.locator('#manga-reader-bar .reader-bar-btn').evaluate_all('b=>b.map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return [s.backgroundColor,s.borderRadius,Math.round(r.width),Math.round(r.height)]})')
            check('Reader bar: close, both chapter arrows and settings look the same (round, filled, 44 dp)',len(styles)==4 and len({tuple(x[:2]) for x in styles})==1 and all(x[2]>=44 and x[3]>=44 for x in styles),styles)
            page.get_by_role('button',name='Next chapter').click();page.get_by_role('button',name='Previous chapter').click()
            check('Chapter arrows move to the next and previous chapter',page.evaluate('chapterMoves')==['next','previous'])
            slider=page.locator('[data-reader-page-slider] input')
            slider.evaluate('e=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(e,"6");e.dispatchEvent(new Event("input",{bubbles:true}))}')
            check('Page slider jumps to a page and the count follows',page.locator('.reader-bar-pages').inner_text().startswith('7'),page.locator('.reader-bar-pages').inner_text())
        stored=lambda page:page.evaluate('Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes("manga")))')
        page,sheet=open_page(360,780)
        groups=sheet.locator('h3').all_inner_texts()
        check('Grouped into Reading, Page and Display',groups==['Reading','Page','Display'],groups)
        text=sheet.inner_text()
        check('No desktop-only options (fullscreen, keyboard shortcuts)','fullscreen' not in text.lower() and 'keyboard' not in text.lower() and 'keybind' not in text.lower())
        check('Long strip hides the reading direction','Direction' not in text)
        heights=sheet.locator('button').evaluate_all('b=>b.map(e=>Math.round(e.getBoundingClientRect().height))')
        check('Every control is a 44 dp+ touch target',min(heights)>=44,heights)
        if shots: page.screenshot(path=str(shots/'harness-reader-settings.png'))
        before=stored(page)
        sheet.get_by_role('button',name='Long strip',exact=True).click()
        sheet.get_by_role('button',name='Single page',exact=True).click()
        after=stored(page)
        check('Mode switch writes the stored reading mode',any(v!=before.get(k) and 'paged' in v.lower() for k,v in after.items()),{k:v for k,v in after.items() if v!=before.get(k)})
        check('Single page shows the reading direction',sheet.get_by_role('group',name='Direction').count()==1)
        sheet.get_by_role('button',name='Right to left',exact=True).click()
        check('Direction writes the stored setting',any('rtl' in v.lower() for v in stored(page).values()))
        zoom=sheet.locator('output').first.inner_text()
        sheet.get_by_role('button',name='Increase Zoom').click()
        check('Zoom stepper changes the zoom',sheet.locator('output').first.inner_text()!=zoom,[zoom,sheet.locator('output').first.inner_text()])
        sheet.get_by_role('button',name='Reset',exact=True).click()
        check('Zoom reset returns to the default',sheet.locator('output').first.inner_text()==zoom)
        text=sheet.inner_text()
        check('New comfort options are offered',all(x in text for x in ['Background','Brightness','Keep the screen on','Tap the middle to show or hide controls']) and 'Progress bar' not in text)
        keep=sheet.get_by_role('switch',name='Keep the screen on')
        k0=keep.get_attribute('aria-checked');keep.click()
        check('Keep screen on writes its stored setting',stored(page).get('sea-manga-keep-screen-on')==('false' if k0=='true' else 'true'),stored(page).get('sea-manga-keep-screen-on'))
        keep.click()
        sheet.get_by_role('button',name='Gray',exact=True).click()
        check('Background choice is stored',stored(page).get('sea-manga-reader-background')=='"gray"',stored(page).get('sea-manga-reader-background'))
        sheet.get_by_role('button',name='Decrease Brightness').click()
        check('Brightness stepper lowers the brightness',stored(page).get('sea-manga-reader-brightness')=='90',stored(page).get('sea-manga-reader-brightness'))
        sheet.get_by_role('button',name='Single page',exact=True).click()
        check('Sheet stays on screen without page overflow',sheet.evaluate('e=>{const r=e.closest("[role=dialog]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}') and page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
        page.close()
        page,sheet=open_page(320,640);page.evaluate('document.documentElement.style.fontSize="200%"');page.wait_for_timeout(200)
        check('320 px at 200 % text: no sideways overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1') and sheet.evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
        if shots: page.screenshot(path=str(shots/'harness-reader-settings-320-200.png'))
        browser.close()
print(json.dumps(checks,indent=2))
