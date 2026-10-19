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
    # A badge created for a card that unmounted before placement must not stay in the hidden container.
    page.evaluate('''()=>{window.__messages=[];__domManager.handleDOMCreate({tagName:'div',requestId:'c1'});__domManager.handleDOMCreate({tagName:'div',requestId:'c2'})}''')
    ids=page.evaluate('__messages.filter(m=>m.type==="DOMCreateResult").map(m=>m.payload.element.id)')
    page.evaluate('''([a,b])=>{__domManager.handleDOMManipulate({elementId:'gone-card',action:'appendChild',params:{childId:a},requestId:'m1'});__domManager.handleDOMManipulate({elementId:'existing',action:'appendChild',params:{childId:b},requestId:'m2'})}''',ids)
    assert page.evaluate('id=>!document.getElementById(id)',ids[0]),'Orphaned plugin element kept in hidden container'
    assert page.evaluate('id=>document.getElementById(id)?.parentElement?.id==="existing"',ids[1]),'Placed plugin element was removed'
    page.evaluate('''()=>__domManager.handleDOMManipulate({elementId:'missing',action:'appendChild',params:{childId:'existing'},requestId:'m3'})''')
    assert page.evaluate('!!document.getElementById("existing")'),'Page element removed for a missing target'
    # Object values (e.g. a CSSStyleDeclaration) are not serialized into data-original.
    page.evaluate('''()=>{const e=document.getElementById('existing');__domManager.handleDOMManipulate({elementId:'existing',action:'setProperty',params:{name:'style',value:'color: red'},requestId:'p1'});__domManager.handleDOMManipulate({elementId:'existing',action:'setProperty',params:{name:'title',value:'x'},requestId:'p2'})}''')
    original=page.evaluate('JSON.parse(document.getElementById("existing").dataset.original||"{}")')
    assert 'style' not in original.get('property',{}) and original['property'].get('title')=='','data-original snapshot wrong: %s'%original
    page.evaluate('''()=>__domManager.cleanup()''')
    b.close()
print('PASS: idle plugins, initial matches, inserted elements, generated ID loops, attributes, unsubscribe, orphaned elements and compact originals')
