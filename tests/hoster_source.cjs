const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, '../backend/internal/extension_repo/mobile/hoster-player.js'), 'utf8');
const hooks = [];
let domCalls = 0;
const ctx = {
    screen: {state: () => ({get: () => ({pathname: '/entry', searchParams: {id: '21'}})}), loadCurrent() {}},
    dom: {onReady: fn => hooks.push(fn), onMainTabReady: fn => hooks.push(fn),
        queryOne: async () => { domCalls++; return null; },
        createElement: async () => { domCalls++; throw Error('Unexpected DOM creation'); }},
    effect: fn => hooks.push(fn),
};
vm.runInNewContext(source + '\ninit()', {$ui: {register: fn => fn(ctx)}});
(async () => {
    for (let routeChange = 0; routeChange < 3; routeChange++) for (const fn of hooks) await fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(domCalls, 0, 'Plugin still attempts to create or restore a launcher');
    assert(!/ensureLauncher|updateVisibility|hpLauncher|hp-launcher|let launcher/.test(source));
    for (const name of ['openOverlay', 'playHoster', 'renderHosters', 'doSearch']) assert(source.includes('async function ' + name + '('));
    console.log('PASS: plugin initial load, DOM ready and repeated route events create no launcher; player functions retained');
})().catch(error => { console.error(error); process.exitCode = 1; });
