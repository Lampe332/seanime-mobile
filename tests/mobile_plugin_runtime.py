"""Production plugin tray, registry, Radix dialogs/fields; isolated websocket transport only."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import tempfile,subprocess,json,sys
root=Path(__file__).resolve().parents[1];results=[]
def check(name,v):
 results.append({'name':name,'passed':bool(v)});assert v,name
with tempfile.TemporaryDirectory(prefix='seanime-runtime-') as t:
 bundle=Path(t)/'runtime.js';subprocess.run(['node',str(root/'tests/mobile_plugin_runtime_bundle.cjs'),str(bundle)],cwd=root,check=True)
 with sync_playwright() as p:
  b=p.chromium.launch(headless=True);page=b.new_page(viewport={'width':320,'height':720},is_mobile=True,has_touch=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('http://runtime.test/**',lambda r:r.fulfill(content_type='text/html',body='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#100d17;color:white;font:16px sans-serif}button,input{font:inherit;color:inherit}button{border:1px solid #69517e;background:#32263f;padding:8px}h1,h2,p{margin:0}.flex{display:flex}.grid{display:grid}.hidden{display:none}.w-full{width:100%}</style></head><body><div id="root"></div></body></html>'))
  page.goto('http://runtime.test/');page.add_style_tag(path=str(bundle.with_suffix('.css')));page.add_script_tag(path=str(bundle));page.wait_for_function('window.runtimeProbe&&window.runtimeFixture')
  page.evaluate('runtimeProbe.tree=runtimeFixture;runtimeProbe.emit("open")');ws=page.locator('.mobile-workspace');ws.wait_for();page.get_by_role('button',name='History episode 28',exact=True).wait_for()
  check('Mobile runtime replaces desktop width/minHeight with contained workspace',ws.evaluate('e=>{const r=e.getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight}') and page.locator('[data-plugin-tray-popover-content]').count()==1)
  page.get_by_role('button',name='History episode 28',exact=True).click();check('Long content scrolls to reachable action with original handler',page.evaluate('runtimeProbe.events.some(e=>e.type==="handler"&&e.payload.handlerName==="episode-28")'))
  page.get_by_label('Filter history',exact=True).fill('safe query');page.wait_for_timeout(450);check('Input retains field transport',page.evaluate('runtimeProbe.events.some(e=>e.type==="field-value"&&e.payload.value==="safe query")'))
  page.get_by_role('button',name='Open settings',exact=True).click();page.get_by_role('heading',name='AnimeThemes settings',exact=True).wait_for();dialogs=page.get_by_role('dialog',include_hidden=True);check('Nested plugin settings use mobile workspace',dialogs.count()==2 and page.locator('.mobile-workspace').count()==2)
  settings=page.locator('.mobile-workspace').filter(has=page.get_by_role('heading',name='AnimeThemes settings',exact=True));check('String fieldRef preset and nonpreset numeric value are visible',settings.get_by_text('AnimeThemes',exact=True).is_visible() and settings.get_by_text('0.7',exact=True).is_visible())
  EDGE=r'e=>{const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),lum=c=>{const f=v=>(v/=255)<=.03928?v/12.92:((v+.055)/1.055)**2.4;return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])};let p=e.parentElement,bg=[0,0,0];while(p){const c=rgb(getComputedStyle(p).backgroundColor);if(c.length>=3&&(c[3]??1)>.5){bg=c;break}p=p.parentElement}const s=getComputedStyle(e),b=rgb(s.borderTopColor),a=b[3]??1,edge=[0,1,2].map(i=>b[i]*a+bg[i]*(1-a)),l1=lum(edge),l2=lum(bg);return [parseFloat(s.borderTopWidth),(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)]}'
  w,ratio=settings.get_by_role('checkbox',name='Show skip data notification').evaluate(EDGE);check('Unchecked checkbox has a visible edge: 2px, 3:1 against its sheet',w>=2 and ratio>=3)
  combos=settings.get_by_role('combobox');combos.nth(1).click();page.get_by_role('option',name='25%',exact=True).click();page.wait_for_timeout(300);check('Numeric option sends original number instead of Radix string',page.evaluate('runtimeProbe.events.some(e=>e.type==="field-value"&&e.payload.fieldRef==="volume"&&e.payload.value===.25)'))
  page.evaluate('window.__seanimeInsets={top:20,bottom:280};window.dispatchEvent(new Event("seanime:window-insets"))');check('Nested settings respect unchanged native keyboard viewport',settings.evaluate('e=>e.getBoundingClientRect().bottom<=innerHeight-280+3'))
  page.evaluate('delete window.__seanimeInsets;window.dispatchEvent(new Event("seanime:window-insets"))');page.evaluate('window.dispatchEvent(new Event("seanime:android-back",{cancelable:true}))');settings.wait_for(state='hidden');check('Android Back closes only top plugin settings',page.get_by_role('dialog').count()==1)
  page.get_by_role('tab',name='schedule',exact=True).click();check('Tabs preserve plugin navigation',page.get_by_text('Schedule settings',exact=True).is_visible());page.get_by_role('tab',name='history',exact=True).click()
  page.evaluate('runtimeProbe.emit("modal",{action:"open",title:"Plugin action",components:{type:"button",id:"action",props:{label:"Safe action",onClick:"safe-action"}}})')
  action=page.locator('.mobile-plugin-action');action.wait_for();action.get_by_role('button',name='Safe action',exact=True).click();check('Server action dialog is above tray with preserved handler context',page.evaluate('runtimeProbe.events.some(e=>e.type==="handler"&&e.payload.handlerName==="safe-action"&&e.id==="controlled-runtime")'))
  page.evaluate('window.dispatchEvent(new Event("seanime:android-back",{cancelable:true}))');action.wait_for(state='hidden');check('Action Back sends existing closed event and preserves tray',page.evaluate('runtimeProbe.events.some(e=>e.type==="modal-closed")') and ws.count()==1)
  page.evaluate('runtimeProbe.emit("command-updated",{placeholder:"Search anime",items:Array.from({length:24},(_,i)=>({id:String(i),value:`Anime ${i}`,label:`Anime ${i}`,heading:"Library",filterType:"includes"}))});runtimeProbe.emit("command-open")')
  palette=page.locator('.mobile-plugin-command');palette.wait_for();palette.get_by_role('combobox').fill('Anime 23');palette.get_by_role('option',name='Anime 23',exact=True).click();check('Mobile command search and item selection retain transport',page.evaluate('runtimeProbe.events.some(e=>e.type==="command-selected"&&e.payload.itemId==="23")'))
  page.evaluate('window.dispatchEvent(new Event("seanime:android-back",{cancelable:true}))');palette.wait_for(state='hidden');check('Command Back restores plugin content',ws.count()==1)
  page.evaluate('document.documentElement.style.fontSize="200%"');page.get_by_role('button',name='History episode 28',exact=True).scroll_into_view_if_needed();check('320px and 200% keep last runtime action inside viewport',page.get_by_role('button',name='History episode 28',exact=True).evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44}'))
  page.evaluate('document.documentElement.style.fontSize=""');page.evaluate('window.dispatchEvent(new Event("seanime:android-back",{cancelable:true}))');ws.wait_for(state='hidden');check('Root back returns Home and releases root scroll',page.evaluate('getComputedStyle(document.documentElement).overflowY')!='hidden')
  for i in range(4):
   page.evaluate('runtimeProbe.emit("open")');ws.wait_for();page.locator('.mobile-workspace-close').click();ws.wait_for(state='hidden')
  check('Repeated plugin opening leaves no duplicate dialog or scroll lock',page.get_by_role('dialog').count()==0 and page.evaluate('getComputedStyle(document.documentElement).overflowY')!='hidden');check('No uncaught runtime exceptions',not errors);b.close()
print(json.dumps(results,indent=2))
if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(results,indent=2),encoding='utf8')


