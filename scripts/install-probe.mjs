import {chromium} from '@playwright/test';
const b=await chromium.launch({headless:true,executablePath:'/opt/hermes/.playwright/chromium_headless_shell-1234/chrome-linux/headless_shell',args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1600,height:1000}}); const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:9119/');await p.waitForFunction(()=>!!window.__HERMES_PLUGIN_SDK__);
console.log(await p.evaluate(async()=>({register:typeof window.__HERMES_PLUGIN_SDK__.register,rescan:await window.__HERMES_PLUGIN_SDK__.api.rescanPlugins(),plugins:await window.__HERMES_PLUGIN_SDK__.api.getPlugins()})));
await p.goto('http://127.0.0.1:9119/workbench');await p.locator('.hwb').waitFor({timeout:7000}).catch(async e=>console.log('MISSING',errors,await p.evaluate(()=>({plugins:window.__HERMES_PLUGINS__,body:document.body.innerText.slice(-3000),scripts:[...document.scripts].map(s=>s.src)}))));await p.waitForTimeout(1500);console.log((await p.locator('body').innerText()).slice(0,4500));console.log({errors});await p.screenshot({path:'evidence/workbench-first.png'});await b.close();
