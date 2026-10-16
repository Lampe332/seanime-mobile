from pathlib import Path
from playwright.sync_api import sync_playwright
import json,subprocess
W=Path(__file__).parent
subprocess.run(['node',str(W/'plugin_dom.cjs')],check=True)
with sync_playwright() as p:
    b=p.chromium.launch(headless=True);page=b.new_page()
    page.set_content('<html><body><div id="existing" class="watched"></div></body></html>')
    page.evaluate('''()=>{window.__walks=0;let original=Element.prototype.querySelectorAll;Element.prototype.querySelectorAll=function(s){if(s==='*')__walks++;return original.call(this,s)}}''')
    page.add_script_tag(path=str(W/'plugin-dom-test.js'))
    page.evaluate('''()=>{let wrapper=document.createElement('section');wrapper.innerHTML='<div><span>idle</span></div>';document.body.appendChild(wrapper)}''')
    page.wait_for_timeout(100)
    assert page.evaluate('__walks')==0,'Idle plugin walked the DOM'
    page.evaluate('''()=>__domManager.handleDOMObserve({selector:'.watched',observerId:'test',withInnerHTML:true})''')
    assert page.evaluate('__messages.some(m=>m.type==="DOMObserveResult" && m.payload.elements.some(e=>e.id==="existing"))')
    page.evaluate('''()=>{window.__messages=[];let e=document.createElement('div');e.className='watched';e.textContent='new';document.body.appendChild(e)}''')
    page.wait_for_timeout(100)
    assert page.evaluate('__messages.filter(m=>m.type==="DOMObserveResult").length')==1,'Generated IDs caused duplicate notifications'
    page.evaluate('''()=>{window.__messages=[];document.querySelector('.watched').setAttribute('data-test','changed')}''')
    page.wait_for_timeout(100)
    assert page.evaluate('__messages.some(m=>m.type==="DOMObserveResult")')
    page.evaluate('''()=>{__domManager.handleDOMStopObserve({observerId:'test'});window.__walks=0;document.body.appendChild(document.createElement('article'))}''')
    page.wait_for_timeout(100)
    assert page.evaluate('__walks')==0
    page.evaluate('''()=>{__domManager.handleDOMObserve({selector:'.cancelled',observerId:'cancel'});window.__messages=[];let e=document.createElement('div');e.className='cancelled';document.body.appendChild(e);queueMicrotask(()=>__domManager.handleDOMStopObserve({observerId:'cancel'}))}''')
    page.wait_for_timeout(100)
    assert not page.evaluate('__messages.some(m=>m.type==="DOMObserveResult")'),'Unsubscribed batch still delivered'
    page.evaluate('''()=>__domManager.cleanup()''')
    b.close()
print('PASS: idle plugins, initial matches, inserted elements, generated ID loops, attributes and unsubscribe')
