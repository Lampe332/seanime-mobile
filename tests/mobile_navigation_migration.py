from pathlib import Path
import re
from playwright.sync_api import sync_playwright

source = (Path(__file__).resolve().parents[1]/'app/src/main/java/com/seanime/app/UIBottomNav.kt').read_text(encoding='utf-8')
scripts = re.findall(r'val js = """(.*?)"""\.trimIndent\(\)', source, re.S)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for full in (False, True):
        page=browser.new_page()
        page.route('http://migration.test/**',lambda r:r.fulfill(body='<html><head></head><body></body></html>',content_type='text/html'))
        page.goto('http://migration.test/')
        page.evaluate('''full=>{
            localStorage.setItem('__seanime_nav_order',JSON.stringify(['home','__float_Offline','android-downloads','menu']));
            localStorage.setItem('__seanime_nav_placement',JSON.stringify({home:'nav',__float_Offline:'float','android-downloads':'float',menu:'nav'}));
            localStorage.setItem('__seanime_float_order',JSON.stringify(['Settings','Offline','Schedule']));
            localStorage.setItem('__seanime_float_hidden',JSON.stringify({Offline:true,Settings:true}));
            if(full) localStorage.setItem('__seanime_nav_items_full',JSON.stringify([
                {id:'home',href:'/',placement:'nav'},
                {id:'__float_Offline',label:'Offline',href:'/sync/?legacy=1',placement:'float'},
                {id:'android-downloads',label:'Downloads',href:'/android-downloads',placement:'float'},
                {id:'menu',isMenu:true,placement:'nav'}]));
        }''',full)
        for script in scripts: page.evaluate(script.replace("${'$'}",'$'))
        saved=page.evaluate('''()=>Object.fromEntries(Object.entries(localStorage).map(([k,v])=>[k,JSON.parse(v)]))''')
        assert saved['__seanime_nav_order']==['home','android-downloads','menu'],saved
        assert saved['__seanime_nav_placement']=={'home':'nav','android-downloads':'float','menu':'nav'},saved
        assert saved['__seanime_float_order']==['Settings','Schedule'],saved
        assert saved['__seanime_float_hidden']=={'Settings':True},saved
        if full:
            items=saved['__seanime_nav_items_full']
            assert [x['id'] for x in items]==['home','android-downloads','menu']
            assert items[1]['placement']=='float'
        page.close()
    browser.close()
print('PASS: legacy full/identity-only navigation migrates without moving or duplicating Downloads; other order, placement and hidden state preserved')
