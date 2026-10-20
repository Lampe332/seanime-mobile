"""Production React/Radix episode targets and info modal; isolated read-only data."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json
root=Path(__file__).resolve().parents[1]
checks=[]
def check(name,ok):
    checks.append(dict(name=name,passed=bool(ok)));assert ok,name
with tempfile.TemporaryDirectory(prefix='seanime-episode-regression-') as tmp:
    bundle=Path(tmp)/'anime.js'
    subprocess.run(['node',str(root/'tests/mobile_anime_bundle.cjs'),str(bundle)],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(viewport=dict(width=320,height=740),has_touch=True,is_mobile=True)
        page.route('http://anime.test/**',lambda r:r.fulfill(content_type='text/html',body='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'))
        page.goto('http://anime.test/')
        for css in (root/'backend/seanime-web/out/static/css').rglob('*.css'):page.add_style_tag(path=str(css))
        page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
        cards=page.locator('[data-episode-grid-item]');cards.first.wait_for()
        cards.nth(1).locator('.mobile-episode-target').focus();page.keyboard.press('Enter')
        check('Keyboard activates the same episode target',page.evaluate('episodeSelections.join()')=='2' and cards.nth(1).get_attribute('data-is-selected')=='true')
        cards.first.get_by_role('button',name='Episode 1: Info',exact=True).click()
        dialog=page.get_by_role('dialog');dialog.wait_for()
        check('Secondary info opens one modal without selecting or playing',page.evaluate('episodeSelections.join()')=='2' and dialog.count()==1)
        page.keyboard.press('Escape');dialog.wait_for(state='hidden')
        check('Closing info restores focus to its trigger',cards.first.get_by_role('button',name='Episode 1: Info',exact=True).evaluate('e=>e===document.activeElement'))
        cards.nth(2).locator('.mobile-episode-target').evaluate('e=>e.click()')
        check('Unavailable/loading target cannot start playback',page.evaluate('episodeSelections.join()')=='2')
        page.evaluate('document.documentElement.style.fontSize="200%"')
        check('Long bilingual episode titles do not overflow at 320px / 200%',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
        cards.first.get_by_role('button',name='Episode 1: Info',exact=True).click();dialog.wait_for()
        check('Long episode description remains scrollable and within viewport',dialog.evaluate('e=>{let r=e.getBoundingClientRect();return r.width<=innerWidth&&e.scrollHeight>e.clientHeight}'))
        page.keyboard.press('Escape');dialog.wait_for(state='hidden')
        check('Repeated close leaves no scroll lock',page.evaluate('document.body.style.overflow!=="hidden"&&document.body.style.pointerEvents!=="none"'))
        box=cards.first.locator('[data-episode-grid-item-image-container]').bounding_box()
        page.touchscreen.tap(box['x']+box['width']/2,box['y']+box['height']/2)
        check('Tapping the thumbnail / play icon selects the episode',page.evaluate('episodeSelections.at(-1)')==1 and cards.first.get_attribute('data-is-selected')=='true')
        browser.close()
print(json.dumps(checks,indent=2))
