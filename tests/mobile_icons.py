from pathlib import Path
import re,json
from mobile_icon_source import icon_script,root
from playwright.sync_api import sync_playwright
scripts=re.findall(r'val js = """(.*?)"""\.trimIndent\(\)',(root/'app/src/main/java/com/seanime/app/UIBottomNav.kt').read_text(encoding='utf-8'),re.S)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True); page=b.new_page(viewport={'width':412,'height':883},is_mobile=True,has_touch=True)
 page.route('http://icons.test/**',lambda r:r.fulfill(body='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><aside class="UI-AppSidebar__sidebar"></aside></body></html>',content_type='text/html'))
 page.goto('http://icons.test/')
 items=[{'id':'home','href':'/','label':'Home','placement':'float','svg':'<svg><path d="M0 0"/></svg>'},{'id':'android-downloads','href':'/android-downloads','label':'Downloads','placement':'nav','svg':'old'},{'id':'custom','href':'/custom','label':'Custom','placement':'nav','svg':'<svg viewBox="0 0 24 24" class="rotate-90" onload="alert(1)"><path d="M4 4h16v16H4z"/></svg>'},{'id':'menu','label':'Menu','isMenu':True,'placement':'nav'}]
 page.evaluate('(items)=>{localStorage.setItem("__seanime_nav_items_full",JSON.stringify(items));localStorage.setItem("__seanime_float_hidden",JSON.stringify({Settings:true}));localStorage.setItem("__seanime_float_order",JSON.stringify(["Settings","Manga"]));}',items)
 page.evaluate(icon_script)
 for script in scripts: page.evaluate(script.replace("${'$'}",'$'))
 actual=page.evaluate('JSON.parse(localStorage.getItem("__seanime_nav_items_full"))')
 assert [(x['id'],x['placement']) for x in actual]==[(x['id'],x['placement']) for x in items]
 assert 'M0 0' not in actual[0]['svg'] and 'stroke-width="1.8"' in actual[0]['svg']
 assert 'M12 3v12' in actual[1]['svg']
 assert 'M4 4h16v16H4z' in actual[2]['svg'] and 'rotate' not in actual[2]['svg'] and 'onload' not in actual[2]['svg']
 assert page.evaluate('localStorage.getItem("__seanime_float_hidden")')=='{"Settings":true}'
 assert page.evaluate('localStorage.getItem("__seanime_float_order")')=='["Settings","Manga"]'
 assert '<circle' in page.evaluate("window.__seanimeIcons.clean('<svg viewBox=\"0 0 24 24\"><use href=\"#missing\"/></svg>')")
 assert '<circle' in page.evaluate("window.__seanimeIcons.clean('<svg><path d=\"M1 1h100\"/></svg>')")
 # Every catalogue vector fits its viewport with room for the stroke.
 bounds=page.evaluate('''()=>{const box=document.createElement('div');document.body.appendChild(box);return Object.keys('''+(root/'backend/seanime-web/src/lib/mobile-icons/icons.json').read_text()+'''.paths).map(k=>{box.innerHTML=window.__seanimeIcons.svg(k);const r=box.firstChild.getBBox();return {k,x:r.x,y:r.y,w:r.width,h:r.height}})}''')
 for r in bounds: assert min(r['x'],r['y'])>=0.9 and r['x']+r['w']<=23.1 and r['y']+r['h']<=23.1,r
 b.close()
print('PASS: stored identities renew icons without moving, hiding or duplicating entries; unknown vectors retain geometry without sidebar classes; catalogue bounds fit 24x24 including strokes')
