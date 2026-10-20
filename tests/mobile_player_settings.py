"""Android phone player settings sheet: grouped rows, inline switches write the same stored values, back steps one page. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
checks=[]
def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok),detail=detail));assert ok,(name,detail)
FITS='e=>{const r=e.getBoundingClientRect();return e.scrollHeight<=e.clientHeight+1&&r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1}'
with tempfile.TemporaryDirectory(prefix='seanime-player-settings-') as tmp:
    bundle=Path(tmp)/'settings.js'
    subprocess.run(['node',str(root/'tests/mobile_anime_bundle.cjs'),str(bundle),'mobile_player_settings_harness.tsx','--no-stubs'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        def open_page(width,height):
            page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=3,has_touch=True,is_mobile=True)
            page.route('http://anime.test/**',lambda r:r.fulfill(content_type='text/html',body='<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'))
            page.goto('http://anime.test/')
            page.evaluate('localStorage.setItem("sea-media-core-preferences",JSON.stringify({version:2,autoPlay:true,autoNext:true,autoSkip:false,playbackRate:1,volumeBoost:1}))')
            page.reload()
            for css in (root/'backend/seanime-web/out/static/css').rglob('*.css'):page.add_style_tag(path=str(css))
            page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
            page.locator('#player button').first.wait_for()
            return page
        def open_sheet(page):
            page.locator('#player button').first.tap()
            sheet=page.locator('.vc-phone-settings');sheet.wait_for();page.wait_for_timeout(250)
            return sheet
        pref=lambda page,key:page.evaluate(f'JSON.parse(localStorage.getItem("sea-media-core-preferences")||"{{}}")["{key}"]')

        page=open_page(360,740);sheet=open_sheet(page)
        groups=sheet.locator('.vc-phone-group-title').all_inner_texts()
        check('Phone sheet shows grouped settings',groups==['Playback','Language & subtitles','Display'] and sheet.get_by_role('heading',name='Player settings').count()==1,groups)
        heights=sheet.locator('.vc-phone-row').evaluate_all('rows=>rows.map(r=>Math.round(r.getBoundingClientRect().height))')
        check('Every row is a 48 dp+ touch target',len(heights)==9 and min(heights)>=48,heights)
        rows=sheet.locator('.vc-phone-row-label').all_inner_texts()
        check('Desktop-only Anime4K and Preferences are not offered on phones','Anime4K' not in rows and 'Preferences' not in rows,rows)
        check('Portrait: whole sheet visible without scrolling',sheet.evaluate(FITS))
        check('Values are readable in their rows',sheet.locator('.vc-phone-row',has_text='Speed').inner_text().split('\n')[-1]=='1.00x' and sheet.locator('.vc-phone-row',has_text='Delay').inner_text().endswith('0.0 s'))
        if shots: page.screenshot(path=str(shots/'harness-settings-portrait.png'))
        for label,key in (('Auto play','autoPlay'),('Auto next','autoNext'),('Skip OP/ED','autoSkip')):
            switch=sheet.get_by_role('switch',name=label);before=pref(page,key)
            check(f'{label}: switch mirrors the stored value',switch.get_attribute('aria-checked')==('true' if before else 'false'),before)
            switch.tap()
            check(f'{label}: switch writes the same stored setting',pref(page,key) is (not before) and switch.get_attribute('aria-checked')==('false' if before else 'true') and sheet.is_visible())
            switch.tap()
            check(f'{label}: second tap restores it',pref(page,key) is before)
        sheet.locator('.vc-phone-row',has_text='Speed').tap()
        back=sheet.locator('[data-vc-element="menu-section-close"]');back.wait_for()
        check('Speed opens its page with a clear back row',back.inner_text().strip()=='Playback speed' and back.evaluate('e=>e.getBoundingClientRect().height')>=48)
        sheet.get_by_role('button',name='1.5',exact=True).tap()
        check('Speed page sets the stored playback rate',pref(page,'playbackRate')==1.5)
        sheet.get_by_role('button',name='1.0',exact=True).tap()
        if shots: page.screenshot(path=str(shots/'harness-settings-speed.png'))
        page.keyboard.press('Escape');page.wait_for_timeout(150)
        check('Back on a sub page returns to the overview',sheet.is_visible() and sheet.locator('[data-vc-phone-settings="home"]').count()==1)
        sheet.locator('.vc-phone-row',has_text='Delay').tap()
        sheet.get_by_role('button',name='+0.1',exact=True).tap()
        check('Subtitle delay page still saves through the subtitle manager',page.evaluate('subtitleUpdates')>=1)
        sheet.get_by_role('button',name='−0.1',exact=True).tap()
        page.keyboard.press('Escape');page.wait_for_timeout(150)
        sheet.locator('.vc-phone-row',has_text='Volume boost').tap();sheet.locator('[data-vc-element="menu-section-close"]').wait_for()
        check('Volume boost page has no keyboard hint',sheet.get_by_text('Shift + Up/Down').count()==0 and sheet.get_by_text('150%').count()==1)
        page.keyboard.press('Escape');page.wait_for_timeout(150)
        sheet.locator('.vc-phone-row',has_text='Style').tap();sheet.get_by_text('On',exact=True).tap();page.wait_for_timeout(150)
        check('Subtitle style page offers no desktop font-file option',sheet.locator('[data-vc-element="menu-sub-option"]',has_text='Font Size').count()==1 and sheet.locator('[data-vc-element="menu-sub-option"]').filter(has_text='Font').count()==1)
        sheet.get_by_text('Off',exact=True).tap();page.keyboard.press('Escape');page.wait_for_timeout(150)
        stored=lambda key:page.evaluate(f'JSON.parse(localStorage.getItem("sea-video-core-settings")||"{{}}")["{key}"]')
        check('Languages row shows the current defaults',sheet.locator('.vc-phone-row',has_text='Languages').inner_text().endswith('English / Japanese'))
        sheet.locator('.vc-phone-row',has_text='Languages').tap();sheet.locator('[data-vc-element="menu-section-close"]').wait_for()
        updates=page.evaluate('subtitleUpdates')
        sheet.locator('[data-vc-element="setting-select"]').first.get_by_text('German',exact=True).tap()
        check('Choosing German subtitles stores the language codes and updates the subtitle manager',stored('preferredSubtitleLanguage')=='de,ger,deu,german' and page.evaluate('subtitleUpdates')>updates)
        if shots: page.screenshot(path=str(shots/'harness-settings-languages.png'))
        sheet.locator('[data-vc-element="setting-select"]').first.get_by_text('English',exact=True).tap()
        check('Choosing English restores the default codes',stored('preferredSubtitleLanguage')=='en,eng,english' and stored('preferredAudioLanguage')=='jpn,jp,jap,japanese')
        page.keyboard.press('Escape');page.wait_for_timeout(150);page.keyboard.press('Escape');page.wait_for_timeout(400)
        check('Back on the overview closes the sheet',page.locator('.vc-phone-settings').count()==0)
        sheet=open_sheet(page);page.locator('#outside').tap();page.wait_for_timeout(400)
        check('Tapping beside the sheet closes it',page.locator('.vc-phone-settings').count()==0)
        page.close()

        page=open_page(800,360);sheet=open_sheet(page)
        cols=sheet.locator('.vc-phone-group').evaluate_all('g=>new Set(g.map(e=>Math.round(e.getBoundingClientRect().left))).size')
        check('Landscape: groups sit side by side and fit without scrolling',cols==3 and sheet.evaluate(FITS),cols)
        if shots: page.screenshot(path=str(shots/'harness-settings-landscape.png'))
        page.close()

        page=open_page(320,640);page.evaluate('document.documentElement.style.fontSize="200%"');sheet=open_sheet(page)
        if shots: page.screenshot(path=str(shots/'harness-settings-320-200.png'))
        check('320 px at 200 % text: no sideways overflow, sheet scrolls inside the screen',sheet.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1}') and page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
        if shots: page.screenshot(path=str(shots/'harness-settings-320-200.png'))
        browser.close()
print(json.dumps(checks,indent=2))
