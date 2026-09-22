import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:'/opt/hermes/.playwright/chromium_headless_shell-1234/chrome-linux/headless_shell',args:['--no-sandbox']});
try {
const p=await browser.newPage({viewport:{width:1600,height:1000}});
await p.goto('http://127.0.0.1:9119/workbench');await p.locator('.hwb').waitFor();
console.log(JSON.stringify(await p.evaluate(()=>{const s=getComputedStyle(document.documentElement); const styles=el=>{if(!el)return null;const c=getComputedStyle(el);return Object.fromEntries(['fontFamily','fontSize','fontWeight','letterSpacing','borderRadius','backgroundColor','color','borderColor','padding'].map(k=>[k,c[k]]));};return {tokens:Object.fromEntries([...s].filter(k=>k.startsWith('--')&&/font|background|midground|text-|radius|button/.test(k)).map(k=>[k,s.getPropertyValue(k)])),components:Object.keys(window.__HERMES_PLUGIN_SDK__.components),brand:styles(document.querySelector('#app-sidebar p')),button:styles(document.querySelector('#app-sidebar button')),workbench:styles(document.querySelector('.hwb'))};}),null,2));
await p.screenshot({path:'evidence/hermes-style-before.png'});
} finally {await browser.close();}
