"""Opt-in acceptance on the regular Samsung APK. No destructive plugin actions.

Run with the existing signed audit CDP forward at localhost:19222.
Pins are restored in finally; fixtures and viewport overrides are removed.
"""
import asyncio,json,argparse,subprocess,shutil
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);opt=parser.parse_args();out=Path(opt.output);out.mkdir(parents=True,exist_ok=True)
 adb=[shutil.which('adb'),'-s','R3CT60PD7YA'];results=[]
 def check(name,value,detail=None):
  results.append(dict(name=name,passed=bool(value),detail=detail));(out/'device-checks.json').write_text(json.dumps(results,indent=2),encoding='utf8');assert value,name
 async with async_playwright() as p:
  b=await p.chromium.connect_over_cdp('http://127.0.0.1:19222');page=next(x for c in b.contexts for x in c.pages if ':43211' in x.url);page.set_default_timeout(12000)
  cdp=await page.context.new_cdp_session(page);await cdp.send('Network.enable');sent=[];errors=[]
  def frame(event):
   try:
    d=json.loads(event['response']['payloadData']);payload=d.get('payload',{});t=payload.get('type','')
    if 'tray:' in t:sent.append({'type':t,'extensionId':payload.get('extensionId')})
   except (ValueError,TypeError):pass
  cdp.on('Network.webSocketFrameSent',frame);page.on('pageerror',lambda e:errors.append(str(e)))
  async def get(path):return await page.evaluate('p=>fetch(p).then(r=>r.json())',path)
  async def shot(name):
   await page.wait_for_timeout(300)
   with (out/name).open('wb') as f:subprocess.run([*adb,'exec-out','screencap','-p'],stdout=f,check=True)
  async def back():
   subprocess.run([*adb,'shell','input','keyevent','4'],check=True,capture_output=True);await page.wait_for_timeout(500)
  trigger=page.locator('.mobile-plugin-trigger');sheet=page.locator('.mobile-plugin-sheet');original=(await get('/api/v1/extensions/plugin-settings'))['data']['pinnedTrayPluginIds'] or []
  baseline=json.loads((out/'pins-before.json').read_text(encoding='utf8'))['data']['pinnedTrayPluginIds'] or []
  check('Original pins preserved by APK update',original==baseline)
  try:
   if await sheet.is_visible():await page.locator('.mobile-plugin-close').click()
   await page.evaluate('window.scrollTo(0,0)');await page.locator('[data-home-episode-card]').first.wait_for();await shot('final-home.png')
   check('One compact Home heading with no image layer',await page.locator('[data-home-navbar] h1').count()==1 and await page.locator('.home-mobile-header img:visible,.home-mobile-backdrop').count()==0)
   check('Continuation is early and retains independent details target',await page.get_by_role('heading',name='Continue watching',exact=True).evaluate('e=>e.getBoundingClientRect().top')<240 and await page.locator('.home-resume-row').count()==1 and await page.get_by_text('Series details',exact=True).count()>0)
   check('Plugin trigger has accessible 44px touch surface and vector icon',await trigger.evaluate('e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&!!e.querySelector("svg")&&e.getAttribute("aria-expanded")==="false"}'))
   await trigger.focus();check('Trigger has visible keyboard focus',await trigger.evaluate('e=>e.matches(":focus-visible")&&getComputedStyle(e).outlineStyle!=="none"'))
   await trigger.click();await sheet.wait_for();await page.wait_for_function('document.querySelectorAll(".mobile-plugin-row").length>0');await page.wait_for_timeout(900);await shot('final-plugins.png')
   ids=await sheet.locator('.mobile-plugin-row').evaluate_all('es=>es.map(e=>e.dataset.pluginId)')
   check('Real ordered plugins and original icons retained',len(ids)==13 and ids==await sheet.locator('.mobile-plugin-row').evaluate_all('es=>es.map(e=>e.dataset.pluginId).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))') and await sheet.locator('.mobile-plugin-icon img').evaluate_all('es=>es.length>0&&es.every(e=>e.complete&&e.naturalWidth>0)'))
   check('Opened trigger state and no automatic search focus',await trigger.get_attribute('aria-expanded')=='true' and not await page.get_by_role('searchbox').evaluate('e=>e===document.activeElement'))
   await page.locator('.mobile-plugin-close').click();await sheet.wait_for(state='hidden');await trigger.click();await sheet.wait_for();await back();check('Android Back closes chooser without leaving Home',not await sheet.is_visible() and page.url.endswith('/'))
   await trigger.click();subprocess.run([*adb,'shell','input','tap','56','75'],check=True,capture_output=True);await page.wait_for_timeout(400);check('Physical-style outside tap closes chooser',not await sheet.is_visible())
   await page.evaluate('window.scrollTo(0,130)');y=await page.evaluate('scrollY');await trigger.evaluate('e=>e.click()');await sheet.wait_for();subprocess.run([*adb,'shell','input','swipe','720','450','720','130','400'],capture_output=True,check=True);check('Outside swipe cannot scroll Home while chooser is open',abs(await page.evaluate('scrollY')-y)<2);await page.locator('.mobile-plugin-close').click();await page.wait_for_timeout(300);check('Closing preserves previous Home scroll position',abs(await page.evaluate('scrollY')-y)<2,{'before':y,'after':await page.evaluate('scrollY')})
   await page.evaluate('window.scrollTo(0,0)');await trigger.click();q=page.get_by_role('searchbox');await q.fill('AnimeThemes');check('Search returns real match',await sheet.locator('.mobile-plugin-row').count()==1)
   await q.fill('no-match-controlled-196');check('Search empty result status',await sheet.get_by_text('No matching plugins',exact=True).is_visible());await page.get_by_role('button',name='Clear search',exact=True).click();check('Clear restores original order',await sheet.locator('.mobile-plugin-row').evaluate_all('es=>es.map(e=>e.dataset.pluginId)')==ids)
   await sheet.locator('.mobile-plugin-row').last.scroll_into_view_if_needed();check('Last real entry has reachable open and pin targets',await sheet.locator('.mobile-plugin-row').last.evaluate('e=>[...e.querySelectorAll("button")].every(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})'));await shot('plugins-last.png')
   safe=sheet.locator('.mobile-plugin-row').filter(has_text='Episodes History');test_id=await safe.get_attribute('data-plugin-id');before_clicks=sum(x['type']=='tray:clicked' for x in sent)
   await safe.locator('.mobile-plugin-pin').click();await page.wait_for_timeout(600);changed=(await get('/api/v1/extensions/plugin-settings'))['data']['pinnedTrayPluginIds'] or [];expected=[x for x in original if x!=test_id] if test_id in original else original+[test_id]
   check('Pin changes only the selected saved ID and keeps chooser open',changed==expected and await sheet.is_visible());check('Pin never sends a plugin-start event',sum(x['type']=='tray:clicked' for x in sent)==before_clicks)
   await page.locator('.mobile-plugin-close').click();await trigger.click();safe=sheet.locator('.mobile-plugin-row').filter(has_text='Episodes History');check('Pin persists after reopening',await safe.locator('.mobile-plugin-pin').get_attribute('aria-pressed')==str(test_id in changed).lower());await safe.locator('.mobile-plugin-pin').click();await page.wait_for_timeout(600);check('Unpin or repin restores original saved pins without plugin start',(await get('/api/v1/extensions/plugin-settings'))['data']['pinnedTrayPluginIds']==original and sum(x['type']=='tray:clicked' for x in sent)==before_clicks)
   qr=await q.bounding_box();scale=1440/await page.evaluate('innerWidth');subprocess.run([*adb,'shell','input','tap',str(int((qr['x']+qr['width']/2)*scale)),str(int((qr['y']+qr['height']/2)*scale))],check=True,capture_output=True);await page.wait_for_timeout(700);ime=subprocess.check_output([*adb,'shell','dumpsys','input_method'],text=True,encoding='utf-8',errors='replace');(out/'keyboard-state.txt').write_text(ime,encoding='utf8');await shot('plugins-keyboard.png')
   keyboard=await page.evaluate('({h:innerHeight,v:visualViewport.height,top:visualViewport.offsetTop,native:window.__seanimeInsets})');check('Real Android keyboard is shown', 'mInputShown=true' in ime or 'isInputViewShown=true' in ime,keyboard)
   check('Search and close remain within visible keyboard viewport',await sheet.evaluate('e=>{const v=visualViewport;return [e.querySelector("input"),e.querySelector(".mobile-plugin-close")].every(n=>{const r=n.getBoundingClientRect();return r.top>=v.offsetTop&&r.bottom<=v.offsetTop+v.height})}'));await sheet.locator('.mobile-plugin-row').last.scroll_into_view_if_needed();check('Last row remains above real Samsung keyboard',await sheet.locator('.mobile-plugin-row').last.evaluate('e=>e.getBoundingClientRect().bottom<=innerHeight-(window.__seanimeInsets?.bottom||0)/devicePixelRatio+3'));await shot('plugins-keyboard.png');await q.fill('Anime');await back();check('First Back dismisses keyboard and keeps chooser',await sheet.is_visible());await back();check('Next Back closes chooser',not await sheet.is_visible())
   await trigger.click();safe=sheet.locator('.mobile-plugin-row').filter(has_text='Episodes History');await safe.locator('.mobile-plugin-open').click();await page.locator('[data-plugin-tray-popover-content]').wait_for();await page.wait_for_timeout(600);await shot('safe-episodes-history.png');check('Read-only Episodes History opens after chooser closes',not await sheet.is_visible() and await page.locator('[data-plugin-tray-popover-content]').is_visible());check('Exactly one start event targets harmless Episodes History',sum(x['type']=='tray:clicked' for x in sent)==before_clicks+1,[x for x in sent if x['type']=='tray:clicked'])
   await back()
   if await page.locator('[data-plugin-tray-popover-content]').is_visible():await back()
   check('Android Back dismisses plugin content',await page.locator('[data-plugin-tray-popover-content]').count()==0)
   await cdp.send('Emulation.setDeviceMetricsOverride',{'width':320,'height':740,'deviceScaleFactor':3,'mobile':True});await page.evaluate('document.documentElement.style.fontSize="200%"');await page.evaluate('window.scrollTo(0,0)');await shot('home-320-200.png');check('320px/200% header stays within viewport',await page.locator('.home-mobile-header').evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth}'));await trigger.click();await sheet.locator('.mobile-plugin-row').last.scroll_into_view_if_needed();await shot('plugins-320-200.png');check('320px/200% last row keeps both targets reachable',await sheet.locator('.mobile-plugin-row').last.evaluate('e=>[...e.querySelectorAll("button")].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>=44&&r.height>=44&&r.bottom<=innerHeight})'));await page.locator('.mobile-plugin-close').click();await page.evaluate('document.documentElement.style.fontSize=""');await cdp.send('Emulation.clearDeviceMetricsOverride')
   await page.get_by_role('button',name='Customize',exact=True).click();await page.locator('.home-mobile-settings').wait_for();check('Existing Home customization opens with saved sections',await page.locator('[data-home-mobile-item]').count()==4);await back();check('Existing Home customization closes with Android Back',await page.locator('.home-mobile-settings').count()==0)
   nav=await page.locator('#__seanime_bottom_nav [data-nav-id]').evaluate_all('es=>es.map(e=>e.dataset.navId)');check('Existing bottom navigation is present',len(nav)>=5,nav)
   await page.evaluate('window.scrollTo(0,0)');await shot('final-home.png');check('No uncaught JavaScript errors',not errors,errors)
  finally:
   await page.evaluate('document.documentElement.style.fontSize=""');await cdp.send('Emulation.clearDeviceMetricsOverride')
   current=(await get('/api/v1/extensions/plugin-settings'))['data']['pinnedTrayPluginIds'] or []
   if current!=original:await page.evaluate('pins=>fetch("/api/v1/extensions/plugin-settings/pinned-trays",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pinnedTrayPluginIds:pins})})',original)
   (out/'safe-ws-events.json').write_text(json.dumps(sent,indent=2),encoding='utf8')
 print(json.dumps(results,indent=2))
if __name__=='__main__':asyncio.run(main())
