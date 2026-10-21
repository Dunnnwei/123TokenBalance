import { test,expect } from '@playwright/test';
import { _electron,type ElectronApplication,type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createAccount } from '../../src/core/providers';
import type { Account } from '../../src/core/types';

let app:ElectronApplication,page:Page,dataDir:string,clipboardData:{type:string;data?:string;bookmark?:{title:string;url:string}}[][]=[];
const qa=path.resolve('artifacts/qa');
async function launch(override?:string){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:override||process.env.TB_EXECUTABLE||path.resolve('node_modules/electron/dist/electron.exe'),args:[...(override||process.env.TB_EXECUTABLE?[]:[path.resolve('.')]),`--data-dir=${dataDir}`],env:env as Record<string,string>});page=await app.firstWindow();await expect(page.getByRole('heading',{name:'额度总览.'})).toBeVisible();}
test.beforeEach(async()=>{dataDir=fs.mkdtempSync(path.join(qa,'iteration-data-'));await launch();clipboardData=await app.evaluate(async({clipboard})=>Promise.all((await clipboard.read()).map(item=>Promise.all(item.types.map(async type=>{const value=await item.getType(type);return value instanceof Blob?{type,data:Buffer.from(await value.arrayBuffer()).toString('base64')}:{type,bookmark:value};})))));});
test.afterEach(async()=>{try{await app.evaluate(async({clipboard,ClipboardItem},items)=>{if(!items.length){clipboard.clear();return;}await clipboard.write(items.map(fields=>new ClipboardItem(Object.fromEntries(fields.map(item=>[item.type,item.bookmark??new Blob([Buffer.from(item.data!,'base64')],{type:item.type})])))));},clipboardData);}catch{}await app?.close();});
async function add(name:string,extra:Partial<Account>={}){const a={...createAccount('deepseek'),account:name,enabled:false,...extra};await page.evaluate(a=>window.tokenBalance.save(a),a);return (await page.evaluate(()=>window.tokenBalance.state())).accounts.find(a=>a.account===name)!;}
async function edit(name:string){await page.getByRole('button',{name:`${name} 操作`,exact:true}).click();await page.getByRole('menuitem',{name:'编辑账号',exact:true}).click();}

test('quick capture window recognizes a real DOM, preserves session and refreshes without credentials',async()=>{
  const html='<html lang="zh-CN"><title>Fixture AI</title><body><nav><span>capture@example.invalid</span></nav><section><h2>Current plan</h2><span id="plan">Pro</span></section><article><h2>5 小时额度</h2><div>剩余 <strong id="five">78%</strong></div></article><article><h2>Weekly limit</h2><div><strong id="week">25% used</strong></div></article><article><h2>月额度</h2><div>剩余 <strong id="month">0%</strong></div></article><article><h2>账户余额 CNY</h2><strong id="balance">¥186.42</strong></article><input type="password" value="must-not-capture"><div hidden>API KEY secret-private</div><script>document.cookie="fixture_capture=kept;Secure;Path=/"</script></body></html>';
  await app.evaluate(({app},body)=>{app.on('session-created',s=>{s.protocol.handle('https',()=>new Response(body.replace('78%',String((globalThis as any).__captureValue??78)+'%'),{headers:{'content-type':'text/html; charset=utf-8'}}));});},html);
  await page.getByRole('button',{name:'网页快速添加',exact:true}).first().click();await page.getByLabel('能看到订阅或余额信息的网址').fill('https://capture.invalid/#/usage');
  const created=app.waitForEvent('window');await page.getByRole('button',{name:'打开订阅页面',exact:true}).click();const toolbar=await created;
  await expect(toolbar.getByRole('button',{name:'一键抓取',exact:true})).toBeEnabled();
  await toolbar.getByRole('button',{name:'一键抓取',exact:true}).click();
  await expect(page.locator('.capture-review')).toBeVisible();await expect(page.locator('.capture-review')).toContainText('78%');await expect(page.locator('.capture-review')).toContainText('75%');await expect(page.locator('.capture-review')).toContainText('0%');
  await expect(page.getByLabel('账号名称 *')).toHaveValue('capture@example.invalid');
  await page.screenshot({path:path.join(qa,'quick-capture-review.png')});
  await page.getByRole('button',{name:'保存并添加账号',exact:true}).click();await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  const a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.engine).toBe('browser');expect(a.hasSecret).toBe(false);expect(a.infoUrl).toContain('#/usage');expect(a.snapshot?.metrics).toHaveLength(4);
  await expect(toolbar.evaluate(async id=>{try{await window.tokenBalance.reveal(id,1);return 'allowed';}catch(e){return (e as Error).message;}},a.id)).resolves.toContain('来源无效');
  const security=await app.evaluate(async({webContents})=>{const remote=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://capture.invalid'))!;(globalThis as any).__captureValue=64;return{prefs:(remote as any).getLastWebPreferences(),bridge:await remote.executeJavaScript('typeof window.tokenBalance'),cookie:await remote.session.cookies.get({url:'https://capture.invalid'})};});
  expect(security.prefs.nodeIntegration).toBe(false);expect(security.prefs.preload).toBeFalsy();expect(security.bridge).toBe('undefined');expect(security.cookie.some(c=>c.name==='fixture_capture')).toBe(true);
  await page.getByRole('button',{name:'全部刷新',exact:true}).click();await expect.poll(async()=>((await page.evaluate(()=>window.tokenBalance.state())).accounts[0].snapshot?.metrics[0].remainingPercent)).toBe(64);
});

test('saved secrets and headers can be revealed and copied without losing unsaved edits',async()=>{
  await add('记录账号',{secret:'dummy-saved-secret-110',headers:'{"X-Project":"dummy-project-secret"}'});await app.close();await launch();
  await edit('记录账号');await expect(page.getByLabel('API Key / OAuth Access Token',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'显示',exact:true}).click();await expect(page.getByLabel('API Key / OAuth Access Token',{exact:true})).toHaveValue('dummy-saved-secret-110');await expect(page.getByLabel('附加请求头（JSON，可选）')).toHaveValue('{"X-Project":"dummy-project-secret"}');
  await page.getByRole('button',{name:'复制',exact:true}).click();expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe('dummy-saved-secret-110');
  await page.getByLabel('API Key / OAuth Access Token',{exact:true}).fill('dummy-unsaved-edit');await page.getByRole('button',{name:'复制全部信息',exact:true}).click();
  const full=JSON.parse(await app.evaluate(({clipboard})=>clipboard.readText()));expect(full.accounts[0].secret).toBe('dummy-unsaved-edit');expect(full.accounts[0].headers).toContain('dummy-project-secret');
  await page.getByRole('button',{name:'隐藏敏感信息',exact:true}).click();await page.getByRole('button',{name:'显示',exact:true}).click();await expect(page.getByLabel('API Key / OAuth Access Token',{exact:true})).toHaveValue('dummy-unsaved-edit');
  await page.getByRole('button',{name:'清除',exact:true}).click();await page.getByRole('button',{name:'复制全部信息',exact:true}).click();expect(JSON.parse(await app.evaluate(({clipboard})=>clipboard.readText())).accounts[0].secret).toBe('');
  await page.getByRole('button',{name:'保存账号',exact:true}).click();expect((await page.evaluate(()=>window.tokenBalance.state())).accounts[0].hasSecret).toBe(false);
});

test('Agent prompt excludes credentials and returned JSON can be previewed and imported',async()=>{
  await add('Agent 账号',{secret:'never-include-agent-secret',headers:'{"X-Private":"never-include-header"}'});await edit('Agent 账号');await page.getByRole('dialog').getByRole('button',{name:'Agent 帮助',exact:true}).click();
  await page.getByRole('button',{name:'复制 Agent 提示词',exact:true}).click();const prompt=await app.evaluate(({clipboard})=>clipboard.readText());expect(prompt).toContain('123token-config-v1');expect(prompt).not.toContain('never-include-agent-secret');expect(prompt).not.toContain('never-include-header');
  await page.getByLabel('Agent 生成的配置').fill('{bad');await page.getByRole('button',{name:'预览配置',exact:true}).click();await expect(page.getByRole('dialog').last().getByRole('alert')).toContainText('JSON');
  const file=path.join(dataDir,'agent.json');fs.writeFileSync(file,JSON.stringify({format:'123token-config-v1',accounts:[{providerId:'deepseek',account:'Agent 导入',enabled:false}]}));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  await page.getByRole('button',{name:'选择 JSON 文件',exact:true}).click();await page.getByRole('button',{name:'预览配置',exact:true}).click();await expect(page.locator('.config-preview')).toContainText('Agent 导入');await page.screenshot({path:path.join(qa,'agent-help.png')});
  await page.getByRole('button',{name:'添加这些账号',exact:true}).click();const accounts=(await page.evaluate(()=>window.tokenBalance.state())).accounts;expect(accounts).toHaveLength(2);expect(new Set(accounts.map(a=>a.id)).size).toBe(2);
});

test('visible account order can move up/down and persists after restart',async()=>{
  const a=await add('显示 A'),hidden=await add('隐藏 B'),c=await add('显示 C');await page.getByRole('searchbox',{name:'搜索平台或账号'}).fill('显示');await page.getByRole('button',{name:'调整顺序',exact:true}).click();await page.getByRole('button',{name:'下移 显示 A',exact:true}).click();
  await expect.poll(async()=>(await page.evaluate(()=>window.tokenBalance.state())).accounts.map(a=>a.id)).toEqual([c.id,hidden.id,a.id]);await app.close();await launch();expect((await page.evaluate(()=>window.tokenBalance.state())).accounts.map(a=>a.id)).toEqual([c.id,hidden.id,a.id]);
  await page.getByRole('button',{name:'调整顺序',exact:true}).click();await expect(page.getByRole('button',{name:'上移 显示 C',exact:true})).toBeDisabled();await page.getByRole('button',{name:'上移 显示 A',exact:true}).click();expect((await page.evaluate(()=>window.tokenBalance.state())).accounts.map(a=>a.id)).toEqual([c.id,a.id,hidden.id]);
});

test('custom logo and background support built-ins, independent uploads, opacity and backup',async()=>{
  await add('自定义品牌',{providerId:'custom',platformName:'自定义模型',website:'https://example.com',infoUrl:'https://example.com/usage',engine:'manual',manual:{plan:'Pro',planSource:'config',metrics:[{label:'周额度',period:'week',unit:'%',remainingPercent:78}],source:'manual',fetchedAt:new Date().toISOString()}});
  await edit('自定义品牌');await page.getByRole('tab',{name:'Logo 与背景',exact:true}).click();
  await page.getByRole('combobox',{name:'账号 Logo 来源'}).click();await page.getByRole('option',{name:'Claude',exact:true}).click();await page.getByRole('combobox',{name:'背景 Logo 来源'}).click();await page.getByRole('option',{name:'DeepSeek',exact:true}).click();
  await page.locator('#background-opacity').focus();await page.keyboard.press('Home');for(let i=0;i<12;i++)await page.keyboard.press('ArrowRight');await expect(page.locator('#background-opacity')).toHaveValue('12');
  await page.getByRole('button',{name:'保存账号',exact:true}).click();let account=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(account.appearance?.logo).toEqual({kind:'builtin',name:'claude'});expect(account.appearance?.backgroundLogo).toEqual({kind:'builtin',name:'deepseek'});expect(account.appearance?.backgroundOpacity).toBe(.12);
  await edit('自定义品牌');await page.getByRole('tab',{name:'Logo 与背景',exact:true}).click();await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve('assets/icon.png'));
  await page.getByRole('button',{name:'上传账号 Logo',exact:true}).click();await expect(page.getByRole('combobox',{name:'账号 Logo 来源'})).toContainText('已上传');await page.getByRole('button',{name:'上传背景 Logo',exact:true}).click();await expect(page.getByRole('combobox',{name:'背景 Logo 来源'})).toContainText('已上传');
  await page.screenshot({path:path.join(qa,'custom-logo-editor.png')});await page.getByRole('button',{name:'保存账号',exact:true}).click();account=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(account.appearance?.logo?.kind).toBe('image');expect(account.appearance?.backgroundLogo?.kind).toBe('image');
  await expect(page.locator('tbody .platform-logo img')).toHaveAttribute('src',/^data:image\/png;base64/);await expect(page.locator('tbody .custom-watermark')).toHaveCSS('opacity','0.12');await app.close();await launch();expect((await page.evaluate(()=>window.tokenBalance.state())).accounts[0].appearance).toEqual(account.appearance);
  const backup=path.join(dataDir,'logos.tbb');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},backup);
  await page.evaluate(()=>window.tokenBalance.exportBackup('logo-test-password'));await page.evaluate(()=>window.tokenBalance.importBackup('logo-test-password'));expect((await page.evaluate(()=>window.tokenBalance.state())).accounts[1].appearance).toEqual(account.appearance);
});

test('subscription dates, calendar-based suggestions and attention reminders persist',async()=>{
  await add('续费记录');await edit('续费记录');await page.getByRole('tab',{name:'订阅日期',exact:true}).click();await page.locator('#subscription-start').fill('2026-01-31');await expect(page.getByLabel('续费 / 到期日期',{exact:true})).toHaveValue('2026-02-28');await page.getByLabel('提前提醒天数',{exact:true}).fill('10');await page.screenshot({path:path.join(qa,'subscription-dates.png')});await page.getByRole('button',{name:'保存账号',exact:true}).click();
  await expect(page.getByRole('table')).toContainText('订阅：2026-01-31');await expect(page.getByRole('table')).toContainText('续费：2026-02-28');await expect(page.getByRole('table')).toContainText('已到期');await page.getByRole('radio',{name:'需要关注',exact:true}).click();await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);await app.close();await launch();const a=(await page.evaluate(()=>window.tokenBalance.state())).accounts[0];expect(a.subscription?.remindDays).toBe(10);await page.getByRole('button',{name:'DeepSeek 续费记录',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('2026-02-28');
});

test('direct subscription link and focused Alt+O use default-browser action with hash intact',async()=>{
  const url='https://example.com/#/subscription';await add('直达账号',{infoUrl:url});
  await app.evaluate(({shell})=>{(globalThis as any).__opened=[];shell.openExternal=async url=>{(globalThis as any).__opened.push(url);};});
  const link=page.getByRole('button',{name:'打开订阅页 直达账号',exact:true});await link.click();await link.focus();await page.keyboard.press('Alt+o');
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).__opened)).toEqual([url,url]);
});

test('1.0.0 encrypted accounts remain readable in 1.3.0 without migration or credential loss',async()=>{
  const legacy=path.resolve('发布/123TokenBalance-1.0.0-win-x64/123TokenBalance.exe');
  expect(fs.existsSync(legacy)).toBe(true);await app.close();await launch(legacy);
  expect((await page.evaluate(()=>window.tokenBalance.state())).version).toBe('1.0.0');
  const account=await add('旧版账号',{secret:'legacy-dummy-secret',headers:'{"X-Project":"legacy-dummy-project"}'});await app.close();await launch();
  const state=await page.evaluate(()=>window.tokenBalance.state());expect(state.version).toBe('1.3.0');expect(state.warnings).toEqual([]);expect(state.accounts[0].id).toBe(account.id);expect(state.accounts[0].hasSecret).toBe(true);
  await edit('旧版账号');await page.getByRole('button',{name:'显示',exact:true}).click();await expect(page.getByLabel('API Key / OAuth Access Token',{exact:true})).toHaveValue('legacy-dummy-secret');await expect(page.getByLabel('附加请求头（JSON，可选）')).toHaveValue('{"X-Project":"legacy-dummy-project"}');
});
