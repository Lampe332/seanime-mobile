"""Actual chooser + Radix: controlled boundaries, no live plugins or backend writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import subprocess,tempfile,json,sys
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='seanime-plugin-regression-') as temp:
 bundle=Path(temp)/'menu.js';subprocess.run(['node',str(ROOT/'tests/mobile_home_plugins_bundle.cjs'),str(bundle)],cwd=ROOT,check=True)
 results=[]
 def check(name,condition):
  results.append({'name':name,'passed':bool(condition)});assert condition,name
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True);page=browser.new_page(viewport={'width':320,'height':720},is_mobile=True,has_touch=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def serve(route):
   if route.request.url.endswith('broken-icon.png'):route.fulfill(status=404)
   else:route.fulfill(body='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{position:relative!important;overflow-x:hidden!important}body{margin:0;background:#0b0910;color:white;font:16px sans-serif}button,input{font:inherit;color:inherit}button{cursor:pointer}h1,h2,p{margin:0}</style></head><body><div id="root"></div></body></html>',content_type='text/html')
  page.route('http://plugins.test/**',serve);page.goto('http://plugins.test/');page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle))
  trigger=page.locator('.mobile-plugin-trigger');sheet=page.locator('[data-mobile-plugin-overview]')
  check('Without pins Home keeps its original compact header row',page.locator('.home-mobile-heading').evaluate('(e)=>{const a=e.getBoundingClientRect(),b=document.querySelector(".home-mobile-tools").getBoundingClientRect();return b.top<a.bottom&&a.top<b.bottom}'))
  trigger.click();sheet.wait_for();check('Open state and accessible dialog',trigger.get_attribute('aria-expanded')=='true' and sheet.get_attribute('role')=='dialog')
  check('Search does not autofocus or summon the keyboard',page.locator('.mobile-plugin-close').evaluate('e=>e===document.activeElement'))
  check('Broken and missing icons fall back',sheet.locator('.mobile-plugin-icon svg').count()==13)
  renders=page.evaluate('pluginProbe.runtimeRenders');search=page.get_by_role('searchbox');search.fill('plugin 1');check('Search matches',sheet.locator('.mobile-plugin-row').count()==3)
  search.fill('no matches');check('No results status',sheet.get_by_text('No matching plugins',exact=True).is_visible());page.get_by_role('button',name='Clear search').click();check('Clear restores sorted list',sheet.locator('.mobile-plugin-row').count()==13)
  check('Typing never rerenders plugin runtimes',page.evaluate('pluginProbe.runtimeRenders')==renders)
  row=sheet.locator('.mobile-plugin-row').first;row.locator('.mobile-plugin-pin').evaluate('(e)=>{e.click();e.click();e.click()}');check('Synchronous repeated taps save once and show header immediately',page.evaluate('pluginProbe.writes.length')==1 and page.locator('[data-plugin-shortcut=controlled-0]').count()==1);page.wait_for_function('pluginProbe.pins===undefined && !document.querySelector(".mobile-plugin-pin").disabled')
  check('Pin stays open and never starts plugin',sheet.is_visible() and page.evaluate('pluginProbe.opens.length')==0 and row.get_attribute('data-pinned')=='true')
  page.locator('.mobile-plugin-close').click();trigger.click();check('Pinned state survives reopen',sheet.locator('.mobile-plugin-pin').first.get_attribute('aria-pressed')=='true')
  sheet.locator('.mobile-plugin-pin').first.click();page.wait_for_function('!document.querySelector(".mobile-plugin-pin").disabled');check('Unpin stays open without starting plugin',page.evaluate('pluginProbe.opens.length')==0 and sheet.locator('.mobile-plugin-pin').first.get_attribute('aria-pressed')=='false')
  page.evaluate('pluginProbe.update({loading:true})');check('Actual settings loading disables pins',sheet.get_by_text('Loading saved pins…').is_visible() and sheet.locator('.mobile-plugin-pin').first.is_disabled())
  page.evaluate('pluginProbe.update({loading:false,error:true})');sheet.get_by_role('button',name='Try again').click();check('Settings failure retry recovers',not sheet.locator('.mobile-plugin-pin').first.is_disabled())
  page.evaluate('pluginProbe.update({failWrite:true})');sheet.locator('.mobile-plugin-pin').first.click();page.wait_for_function('document.querySelector("[role=alert]")');check('Save failure is visible without opening plugin',page.evaluate('pluginProbe.opens.length')==0)
  page.evaluate('pluginProbe.update({failWrite:false,mutationError:false})')
  page.evaluate('document.documentElement.style.fontSize="200%"');sheet.locator('.mobile-plugin-row').last.scroll_into_view_if_needed();check('320px and 200% font keep last open and pin targets reachable',sheet.locator('.mobile-plugin-row').last.evaluate('e=>[...e.querySelectorAll("button")].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>=44&&r.height>=44})'))
  page.evaluate('document.documentElement.style.fontSize="";window.__seanimeInsets={top:20,bottom:280};window.dispatchEvent(new Event("seanime:window-insets"))')
  check('Native IME inset constrains a WebView with unchanged visualViewport',sheet.evaluate('e=>e.getBoundingClientRect().bottom<=innerHeight-280+2'))
  sheet.locator('.mobile-plugin-row').last.scroll_into_view_if_needed();check('Last entry stays above native keyboard',sheet.locator('.mobile-plugin-row').last.evaluate('e=>e.getBoundingClientRect().bottom<=innerHeight-280+2'))
  page.evaluate('delete window.__seanimeInsets;window.dispatchEvent(new Event("seanime:window-insets"))')
  page.locator('.mobile-plugin-close').click();page.evaluate('document.documentElement.style.fontSize=""');page.evaluate('window.scrollTo(0,130)');y=page.evaluate('scrollY');trigger.evaluate('e=>e.click()');page.mouse.wheel(0,300);page.wait_for_timeout(150);check('Modal blocks background scroll',page.evaluate('scrollY')==y);page.keyboard.press('Escape');check('Escape restores scroll and focus',page.evaluate('scrollY')==y and trigger.evaluate('e=>e===document.activeElement'))
  trigger.click();sheet.locator('.mobile-plugin-open').first.click();page.wait_for_function('pluginProbe.opens.length===1');check('Open invokes only the chosen plugin and dismisses sheet',not sheet.is_visible() and page.evaluate('pluginProbe.opens')==['controlled-0'])
  trigger.click();page.locator('.mobile-plugin-overlay').click(position={'x':10,'y':10});check('Outside tap dismisses',not sheet.is_visible())
  trigger.click();page.evaluate('window.dispatchEvent(new Event("controlled-tray-open"))');sheet.wait_for(state='hidden');check('Programmatic tray open dismisses chooser even for the same plugin',not sheet.is_visible())
  page.evaluate('setControlledIcons([])');trigger.click();check('Empty plugin list is distinct from no search results',sheet.get_by_text('No plugins available',exact=True).is_visible());page.keyboard.press('Escape')
  page.evaluate('setControlledIcons(Array.from({length:13},(_,i)=>({extensionId:`controlled-${i}`,extensionName:`Controlled plugin ${i}`,iconUrl:"",withContent:true})));pluginProbe.update({pins:["controlled-12","missing-plugin","controlled-0","controlled-12",...Array.from({length:11},(_,i)=>`controlled-${i+1}`)]})')
  check('Header preserves saved order, deduplicates and hides unavailable IDs',page.locator('[data-plugin-shortcut]').evaluate_all('es=>es.map(e=>e.dataset.pluginShortcut)')==['controlled-12','controlled-0']+[f'controlled-{i}' for i in range(1,12)])
  check('All pins remain horizontally reachable beside chooser',page.locator('.mobile-plugin-shortcuts').evaluate('e=>e.scrollWidth>e.clientWidth') and trigger.is_visible())
  page.locator('[data-plugin-shortcut=controlled-12]').click();check('Header shortcut opens exactly its plugin',page.evaluate('pluginProbe.opens.at(-1)')=='controlled-12')
  page.evaluate('setControlledIcons(Array.from({length:13},(_,i)=>({extensionId:`controlled-${i}`,extensionName:`Controlled plugin ${i}`,iconUrl:"",withContent:true})));pluginProbe.update({pins:[]})');check('Unpin removes all header shortcuts immediately',page.locator('[data-plugin-shortcut]').count()==0)
  check('No uncaught JS exceptions',not errors);browser.close()
 print(json.dumps(results,indent=2))
 if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(results,indent=2),encoding='utf8')
