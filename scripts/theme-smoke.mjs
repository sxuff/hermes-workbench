import {chromium,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Styling verification only. No model turns or new sessions.
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/opt/hermes/.playwright/chromium_headless_shell-1234/chrome-linux/headless_shell',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={};
try {
 await page.goto('http://127.0.0.1:9119/workbench');
 await expect(page.locator('.hwb-connection')).toHaveText('Connected');
 await page.evaluate(()=>document.fonts.ready);
 report.styles=await page.locator('.hwb').evaluate(el=>{const css=getComputedStyle(el), host=getComputedStyle(document.querySelector('.bg-background-base'));return {background:css.backgroundColor,hostBackground:host.backgroundColor,text:css.color,radius:css.borderRadius,font:css.fontFamily,buttonRadius:getComputedStyle(el.querySelector('.hwb-btn')).borderRadius,buttonCase:getComputedStyle(el.querySelector('.hwb-btn')).textTransform};});
 assert.equal(report.styles.background,report.styles.hostBackground);
 assert.equal(report.styles.radius,'0px');assert.equal(report.styles.buttonRadius,'0px');assert.equal(report.styles.buttonCase,'uppercase');
 await page.getByRole('textbox',{name:'Search sessions'}).fill('Workbench UI verification');
 await page.screenshot({path:'evidence/hermes-style-embedded.png'});
 await page.getByRole('button',{name:'Expand workbench'}).click();
 await page.screenshot({path:'evidence/hermes-style-desktop.png'});
 // Target the successful proof by durable identity, not recency or sidebar order.
 const proof=JSON.parse(await readFile('evidence/ui-smoke.json','utf8'));
 const detail=await page.evaluate(id=>window.__HERMES_PLUGIN_SDK__.api.getSessionDetail(id,'default'),proof.identity.sessions[0].storedId);
 assert.ok(detail.title);
 const session=page.locator('.hwb-session').filter({hasText:detail.title});
 await session.click();
 await expect(page.getByRole('textbox',{name:'Message Hermes'})).toBeEnabled({timeout:30000});
 await expect(page.locator('.hwb-message.assistant').filter({hasText:'WORKBENCH_UI_OK'})).toBeVisible({timeout:30000});
 await expect(page.getByRole('button',{name:'Rename',exact:true})).toBeEnabled();
 await page.getByRole('textbox',{name:'Message Hermes'}).fill('');
 report.historyRendered=true;
 await page.screenshot({path:'evidence/hermes-style-session.png'});
 await page.getByRole('button',{name:/^Agents/}).click();await expect(page.getByRole('complementary',{name:'Subagents'})).toBeVisible();
 await page.getByRole('button',{name:'Close agents',exact:true}).last().click();
 // Change tokens inside this page only. Do not persist host theme preferences.
 await page.evaluate(()=>{const r=document.documentElement; r.style.setProperty('--background-base','#faf8f5');r.style.setProperty('--midground-base','#25221f');r.style.setProperty('--color-text-secondary','#615c56');});
 report.light=await page.locator('.hwb').evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color}));
 assert.equal(report.light.background,'rgb(250, 248, 245)');assert.equal(report.light.text,'rgb(37, 34, 31)');
 await page.screenshot({path:'evidence/hermes-style-light.png'});
 await page.evaluate(()=>{const r=document.documentElement;r.style.setProperty('--background-base','#041c1c');r.style.setProperty('--midground-base','#ffe6cb');r.style.setProperty('--color-text-secondary','color-mix(in srgb, #ffe6cb 80%, transparent)');});
 await page.getByRole('button',{name:'Exit expanded view'}).click();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Expand workbench'}).click();
 await page.screenshot({path:'evidence/hermes-style-mobile.png'});
 report.mobileOverflow=await page.locator('.hwb').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(report.mobileOverflow,false);
 await page.getByRole('button',{name:'Toggle sessions'}).click();
 await expect(page.getByRole('textbox',{name:'Search sessions'})).toBeVisible();
 const backdrop=page.getByRole('button',{name:'Close sessions',exact:true});
 const box=await backdrop.boundingBox();assert.ok(box);await backdrop.click({position:{x:box.width-12,y:24}});
 await expect(page.getByRole('textbox',{name:'Search sessions'})).toBeHidden();
 report.mobileDrawer=true;report.errors=errors;assert.deepEqual(errors,[]);
 await writeFile('evidence/theme-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
