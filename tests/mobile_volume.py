"""Mobile player volume: tapping the speaker opens a slider instead of muting; dragging sets the volume. Optional arg: screenshot dir."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile, subprocess, json, sys
root=Path(__file__).resolve().parents[1]
shots=Path(sys.argv[1]) if len(sys.argv)>1 else None
checks=[]
def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok),detail=detail));assert ok,(name,detail)
with tempfile.TemporaryDirectory(prefix='seanime-volume-') as tmp:
    bundle=Path(tmp)/'volume.js'
    subprocess.run(['node',str(root/'tests/mobile_anime_bundle.cjs'),str(bundle),'mobile_volume_harness.tsx'],check=True,cwd=root)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(viewport=dict(width=360,height=400),device_scale_factor=3,has_touch=True,is_mobile=True)
        page.route('http://anime.test/**',lambda r:r.fulfill(content_type='text/html',body='<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'))
        page.goto('http://anime.test/')
        for css in (root/'backend/seanime-web/out/static/css').rglob('*.css'):page.add_style_tag(path=str(css))
        page.add_script_tag(path=str(bundle))
        state=lambda:page.evaluate('volumeState')
        icon=page.locator('[data-vc-element="control-volume"] > button').first;icon.wait_for()
        icon.tap();page.wait_for_timeout(100)
        slider=page.locator('[data-vc-element="control-volume-mobile-slider"]')
        check('Tapping the speaker opens the volume slider and does not mute',slider.is_visible() and state()['muted'] is False and state()['open'] is True,state())
        check('Slider shows the current volume',slider.get_attribute('aria-valuenow')=='80')
        if shots: page.screenshot(path=str(shots/'harness-volume-panel.png'))
        b=slider.bounding_box()
        page.mouse.move(b['x']+b['width']*0.9,b['y']+b['height']/2);page.mouse.down();page.mouse.move(b['x']+b['width']*0.25,b['y']+b['height']/2,steps=5);page.mouse.up()
        s=state()
        check('Dragging the slider lowers the volume',abs(s['volume']-0.0625)<0.02 and s['muted'] is False,s)
        page.mouse.click(b['x']+1,b['y']+b['height']/2);s=state()
        check('Sliding to the start mutes',s['volume']<0.01 and s['muted'] is True,s)
        page.mouse.click(b['x']+b['width']*0.5,b['y']+b['height']/2);s=state()
        check('Sliding up again unmutes',abs(s['volume']-0.25)<0.03 and s['muted'] is False,s)
        page.locator('#outside').tap();page.wait_for_timeout(100)
        check('Tapping outside closes the slider',slider.count()==0 and state()['open'] is False)
        icon.tap();page.wait_for_timeout(3800)
        check('Slider closes by itself after a few idle seconds',slider.count()==0)
        browser.close()
print(json.dumps(checks,indent=2))
