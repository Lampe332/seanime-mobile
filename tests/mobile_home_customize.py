"""Actual Customize Home dialog + Radix: controlled saving boundary, no backend writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import subprocess,tempfile,json,sys
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='seanime-customize-regression-') as temp:
 bundle=Path(temp)/'customize.js';subprocess.run(['node',str(ROOT/'tests/mobile_home_customize_bundle.cjs'),str(bundle)],cwd=ROOT,check=True)
 results=[]
 def check(name,condition):
  results.append({'name':name,'passed':bool(condition)});assert condition,name
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True);page=browser.new_page(viewport={'width':384,'height':823},is_mobile=True,has_touch=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('http://customize.test/**',lambda r:r.fulfill(body='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#0b0910;color:white;font:16px sans-serif}button{font:inherit;color:inherit;background:none;border:0}h1,h2,h3,h4,p{margin:0}</style></head><body><div id="root"></div></body></html>',content_type='text/html'))
  page.goto('http://customize.test/');page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
  # The Android shell's modal patch (UIHomePatch.kt) is present on every device page.
  page.add_style_tag(content='.UI-Modal__content:not(.mobile-workspace){padding:3.5rem .75rem 1rem .75rem!important;max-height:100svh!important;overflow-y:auto!important;width:100%!important;max-width:100vw!important}')
  page.evaluate('openCustomize()');dialog=page.locator('.home-mobile-settings');dialog.wait_for()
  rows=page.locator('[data-home-mobile-item]');ids=lambda:rows.evaluate_all('es=>es.map(e=>e.dataset.homeMobileItem)')
  check('Saved sections are listed in order',ids()==['a','b','c','d'])
  check('Active sections show a checked switch',page.locator('[data-home-mobile-item] [role=switch]').evaluate_all('es=>es.every(e=>e.getAttribute("aria-checked")==="true")'))
  check('Inactive sections show an unchecked switch',page.locator('[data-home-available-item] [role=switch]').evaluate_all('es=>es.length>0&&es.every(e=>e.getAttribute("aria-checked")==="false")'))
  check('Sections use readable names','Continue watching' in rows.first.inner_text())
  check('No position numbers or per-row remove buttons remain',page.locator('.home-section-position,.home-remove-action').count()==0)
  # Every "?" opens a centered card with the section text, and every close path works.
  infos=page.locator('.home-customize-info');count=infos.count();texts=set()
  closers=['ok','outside','escape','back']
  for i in range(count):
   infos.nth(i).click();card=page.locator('.home-info-card');card.wait_for()
   text=card.locator('p').inner_text();texts.add(text)
   box=card.bounding_box();vw,vh=384,823
   assert abs(box['x']+box['width']/2-vw/2)<2 and abs(box['y']+box['height']/2-vh/2)<2,'card centered'
   how=closers[i%4]
   if how=='ok':card.get_by_role('button',name='OK').click()
   elif how=='outside':page.wait_for_timeout(250);page.touchscreen.tap(8,8)
   elif how=='escape':page.keyboard.press('Escape')
   else:
    prevented=page.evaluate('(()=>{const e=new Event("seanime:android-back",{cancelable:true});return !window.dispatchEvent(e)})()')
    assert prevented,'android back handled'
   card.wait_for(state='detached',timeout=5000)
   assert dialog.is_visible(),'Customize stays open after closing info: '+how
  check(f'All {count} info buttons open a centered card and close via OK, outside tap, Escape and Android Back',count==page.locator('.home-customize-row').count() and len(texts)==count and all(len(t)>40 for t in texts))
  infos.first.click();overlay=page.locator('.home-info-overlay')
  check('Only the fixed overlay blurs and dims',overlay.evaluate('e=>{const s=getComputedStyle(e);return s.position==="fixed"&&s.backdropFilter.includes("blur")}') and dialog.evaluate('e=>getComputedStyle(e).backdropFilter==="none"'))
  check('Info card is a labelled dialog',page.locator('.home-info-card').get_attribute('role')=='dialog' and page.locator('.home-info-card h2').inner_text()=='Continue watching')
  page.keyboard.press('Escape');page.locator('.home-info-card').wait_for(state='detached')
  # Reorder, switch off, switch on.
  rows.nth(1).get_by_role('button',name='Move up: Anime library').click();page.wait_for_function('customizeProbe.state.items[0].id==="b"')
  check('Move up saves the new order',ids()==['b','a','c','d'])
  rows.nth(0).get_by_role('button',name='Move down: Anime library').click();page.wait_for_function('customizeProbe.state.items[0].id==="a"')
  check('Move down restores the order',ids()==['a','b','c','d'])
  check('First and last reorder buttons are disabled',rows.first.get_by_role('button',name='Move up: Continue watching').is_disabled() and rows.last.get_by_role('button',name='Move down: Aired recently').is_disabled())
  page.locator('[data-home-mobile-item=d] [role=switch]').click();page.wait_for_function('customizeProbe.state.items.length===3')
  check('Switching a section off removes it',ids()==['a','b','c'] and page.locator('[data-home-available-item=aired-recently] [role=switch]').get_attribute('aria-checked')=='false')
  page.locator('[data-home-available-item=aired-recently] [role=switch]').click();page.wait_for_function('customizeProbe.state.items.length===4')
  check('Switching a section on adds it at the end',page.evaluate('customizeProbe.state.items.map(i=>i.type)')==['anime-continue-watching','anime-library','manga-library','aired-recently'])
  page.evaluate('customizeProbe.update({items:[{id:"a",type:"anime-continue-watching",schemaVersion:1},{id:"b",type:"anime-library",schemaVersion:2},{id:"c",type:"manga-library",schemaVersion:2},{id:"d",type:"aired-recently",schemaVersion:1}]})')
  # Options open in their own tidy sheet and save without losing values.
  rows.nth(1).get_by_role('button',name='Options: Anime library').click();opts=page.locator('.home-mobile-options');opts.wait_for()
  check('Options sheet is titled with the section',opts.get_by_text('Options: Anime library').is_visible())
  chip=opts.locator('.home-option-chips button').first;before=chip.get_attribute('aria-pressed');chip.click()
  check('Option chips expose their pressed state',chip.get_attribute('aria-pressed')!=before)
  opts.get_by_role('button',name='Save',exact=True).click();page.wait_for_function('customizeProbe.state.items[1].options')
  check('Options save into the existing item',page.evaluate('customizeProbe.state.items[1].options.statuses.length')>=1 and page.evaluate('customizeProbe.state.items.length')==4)
  page.locator('.home-mobile-options').wait_for(state='detached')
  page.evaluate('customizeProbe.update({items:[{id:"a",type:"anime-continue-watching",schemaVersion:1},{id:"b",type:"anime-library",schemaVersion:2},{id:"c",type:"manga-library",schemaVersion:2},{id:"d",type:"aired-recently",schemaVersion:1}]})')
  # German, 320px and 200% text.
  page.evaluate('customizeProbe.update({lang:"de"})')
  check('German labels follow the app language','Weiterschauen' in rows.first.inner_text() and page.get_by_text('Weitere Bereiche').is_visible())
  infos.first.click();check('German info text',page.locator('.home-info-card p').inner_text().startswith('Zeigt die nächste Folge'));page.get_by_role('button',name='OK').click()
  page.set_viewport_size({'width':320,'height':740});page.evaluate('document.documentElement.style.fontSize="200%"');page.wait_for_timeout(200)
  fits=dialog.evaluate('e=>e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll(".home-customize-row")].every(r=>r.scrollWidth<=r.clientWidth+1)')
  targets=dialog.evaluate('e=>[...e.querySelectorAll(".home-customize-row button")].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth+1})')
  names=dialog.evaluate('e=>[...e.querySelectorAll(".home-customize-name")].every(n=>n.getBoundingClientRect().width>=80)')
  page.screenshot(path=str(Path(sys.argv[1] if len(sys.argv)>1 else temp)/'customize-320-200.png'))
  check('320px and 200% text: no horizontal overflow, targets >=44px inside the screen, names stay readable',fits and targets and names)
  check('320px and 200% text: sheet title wraps between words only',dialog.evaluate('''e=>{const t=e.querySelector('.UI-Modal__title');const w=document.createTreeWalker(t,NodeFilter.SHOW_TEXT);let ok=true;while(w.nextNode()){const n=w.currentNode;const re=/\S+/g;let m;while((m=re.exec(n.data))){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);if(r.getClientRects().length>1)ok=false}}return ok}'''))
  infos.first.click();card=page.locator('.home-info-card')
  check('320px and 200% text: info card fits the screen',card.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}'))
  page.get_by_role('button',name='OK').click()
  page.emulate_media(reduced_motion='reduce');infos.first.click()
  check('Reduced motion: info card does not animate',page.locator('.home-info-card').evaluate('e=>getComputedStyle(e).animationName==="none"') and page.locator('.home-info-overlay').evaluate('e=>getComputedStyle(e).animationName==="none"'))
  page.keyboard.press('Escape')
  check('No unhandled page errors',not errors)
  browser.close()
 print(json.dumps(results,indent=1))
