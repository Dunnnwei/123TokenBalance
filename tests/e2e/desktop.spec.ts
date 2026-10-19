import { test,expect } from '@playwright/test';
import { _electron,type ElectronApplication,type Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createAccount } from '../../src/core/providers';
import type { Account,Metric,Snapshot } from '../../src/core/types';
let electron:ElectronApplication,page:Page,dataDir:string;
const qa=path.resolve('artifacts/qa');fs.mkdirSync(qa,{recursive:true});
async function launch(){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  electron=await _electron.launch({executablePath:process.env.TB_EXECUTABLE||path.resolve('node_modules/electron/dist/electron.exe'),args:[...(process.env.TB_EXECUTABLE?[]:[path.resolve('.')]),`--data-dir=${dataDir}`],env:env as Record<string,string>});
  page=await electron.firstWindow();await expect(page.getByRole('heading',{name:'额度总览.'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!window.tokenBalance)).toBe(true);
}
test.beforeEach(async()=>{dataDir=fs.mkdtempSync(path.join(qa,'desktop-data-'));await launch();});
test.afterEach(async()=>{await electron?.close();});
async function seed(){
  const specs:[string,string,string,Metric[]][]=[
    ['codex','工作账号 · 演示','Plus',[{label:'订阅',period:'5h',unit:'%',remainingPercent:78},{label:'订阅',period:'week',unit:'%',remainingPercent:42}]],
    ['codex','个人账号 · 演示','Pro',[{label:'订阅',period:'5h',unit:'%',remainingPercent:96},{label:'订阅',period:'week',unit:'%',remainingPercent:83}]],
    ['claude','设计工作室 · 演示','Max',[{label:'订阅',period:'5h',unit:'%',remainingPercent:18},{label:'订阅',period:'week',unit:'%',remainingPercent:62}]],
    ['deepseek','开发测试 · 演示','API 按量付费',[{label:'可用余额',period:'balance',unit:'CNY',remaining:186.42}]],
    ['zhipu','GLM 编码 · 演示','Pro',[{label:'订阅',period:'5h',unit:'%',remainingPercent:65},{label:'订阅',period:'week',unit:'%',remainingPercent:52},{label:'订阅',period:'month',unit:'%',remainingPercent:81}]],
    ['minimax-cn','创作项目 · 演示','Plus',[{label:'模型额度',period:'5h',unit:'%',remainingPercent:91},{label:'模型额度',period:'week',unit:'%',remainingPercent:75}]],
    ['kimi-code','研究项目 · 演示','Moderato',[{label:'订阅',period:'5h',unit:'%',remainingPercent:43},{label:'订阅',period:'week',unit:'%',remainingPercent:27}]],
  ];
  for(const [id,name,plan,metrics] of specs){const a:Account={...createAccount(id),account:name,plan,engine:'manual',manual:{plan,planSource:'config',metrics,fetchedAt:new Date().toISOString(),source:'manual'}};await page.evaluate(a=>window.tokenBalance.save(a),a);}
}
test('UI account creation, encrypted restart, independent duplicate and deletion',async()=>{
  await page.getByRole('button',{name:'添加账号',exact:true}).first().click();
  await page.getByRole('combobox',{name:'平台模板'}).click();await page.getByRole('option',{name:'DeepSeek',exact:true}).click();
  await page.getByLabel('账号标识 *').fill('qa-one@example.invalid');
  await page.getByLabel('API Key / OAuth Access Token', {exact:true}).fill('dummy-qa-secret-12345');
  await page.getByRole('switch',{name:'参与全部刷新'}).click();
  await page.getByRole('button',{name:'保存账号',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  const disk=fs.readFileSync(path.join(dataDir,'accounts.enc.json'),'utf8');expect(disk).not.toContain('dummy-qa-secret');expect(disk).not.toContain('qa-one@');
  await page.getByRole('button',{name:'qa-one@example.invalid 操作'}).click();await page.getByRole('menuitem',{name:'复制配置（不含认证）'}).click();
  await page.getByLabel('账号标识 *').fill('qa-two@example.invalid');
  await expect(page.getByLabel('API Key / OAuth Access Token',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'保存账号',exact:true}).click();await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2);
  await electron.close();await launch();await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2);
  const rows=await page.evaluate(()=>window.tokenBalance.state());expect(rows.accounts[0].hasSecret).toBe(true);expect(rows.accounts[1].hasSecret).toBe(false);expect(rows.accounts[0].id).not.toBe(rows.accounts[1].id);
  await page.getByRole('button',{name:'qa-one@example.invalid 操作'}).click();await page.getByRole('menuitem',{name:'删除账号',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'删除账号'}).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);await expect(page.getByRole('table')).toContainText('qa-two@example.invalid');
});
test('custom connector field mapping previews real JSON and HTML samples',async()=>{
  await page.getByRole('button',{name:'平台与接入',exact:true}).click();await page.getByRole('button',{name:'自定义平台',exact:true}).click();
  await page.getByLabel('平台名称',{exact:true}).fill('未收录平台');await page.getByLabel('账号标识 *').fill('custom-demo');
  await page.getByLabel('平台网址 *',{exact:true}).fill('https://example.com');await page.getByLabel('获取信息的页面网址 *').fill('https://example.com/usage');
  await page.getByLabel('查询 API / HTML 地址 *').fill('https://example.com/api/usage');
  await page.getByRole('tab',{name:'字段映射'}).click();await page.getByLabel('套餐名称路径（可选）').fill('data.plan');
  await page.getByRole('button',{name:'添加额度字段'}).click();await page.getByLabel('字段 1 数值路径').fill('data.left');
  await page.getByRole('tab',{name:'测试与预览'}).click();await page.getByLabel('粘贴 JSON / HTML 响应样本').fill('{"data":{"plan":"Pro","left":72}}');await page.getByRole('button',{name:'预览解析结果'}).click();
  await expect(page.locator('.snapshot-preview')).toContainText('72%');await expect(page.locator('.snapshot-preview')).toContainText('Pro');
  await page.screenshot({path:path.join(qa,'custom-connector.png')});
  await page.getByRole('button',{name:'保存账号',exact:true}).click();
  const state=await page.evaluate(()=>window.tokenBalance.state());expect(state.accounts[0].mappings[0].valuePath).toBe('data.left');
  const a={...state.accounts[0],engine:'html' as const,planPath:'#plan',mappings:[{...state.accounts[0].mappings[0],valuePath:'.quota::attr(data-left)'}]};
  const parsed=await page.evaluate(({a})=>window.tokenBalance.preview(a,'<b id="plan">Team</b><i class="quota" data-left="0"></i>'),{a});expect(parsed.plan).toBe('Team');expect(parsed.metrics[0].remainingPercent).toBe(0);
});
test('HAUI light, dark, responsive views and accessibility',async()=>{
  await seed();await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(7);
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('radio',{name:'浅色',exact:true}).click();await page.getByRole('button',{name:'额度总览',exact:false}).first().click();
  await page.screenshot({path:path.join(qa,'overview-light.png'),fullPage:true});
  const light=await new AxeBuilder({page}).setLegacyMode(true).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();fs.writeFileSync(path.join(qa,'a11y-light.json'),JSON.stringify(light.violations,null,2));expect(light.violations).toEqual([]);
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('radio',{name:'深色',exact:true}).click();await page.getByRole('button',{name:'额度总览',exact:false}).first().click();
  await page.screenshot({path:path.join(qa,'overview-dark.png'),fullPage:true});
  const dark=await new AxeBuilder({page}).setLegacyMode(true).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();fs.writeFileSync(path.join(qa,'a11y-dark.json'),JSON.stringify(dark.violations,null,2));expect(dark.violations).toEqual([]);
  await page.getByRole('searchbox',{name:'搜索平台或账号'}).fill('个人');await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await page.getByRole('searchbox',{name:'搜索平台或账号'}).fill('不存在');await expect(page.getByText('没有匹配的账号')).toBeVisible();await page.getByRole('button',{name:'清除筛选'}).click();
  await page.evaluate(()=>{document.documentElement.style.zoom='1.25';});await page.screenshot({path:path.join(qa,'overview-125-percent.png'),fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.zoom='1.5';});await page.screenshot({path:path.join(qa,'overview-150-percent.png'),fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.zoom='1';});await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:path.join(qa,'overview-narrow.png'),fullPage:true});
  fs.writeFileSync(path.join(qa,'overflow-debug.json'),JSON.stringify(await page.evaluate(()=>({width:innerWidth,root:document.documentElement.scrollWidth,items:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth&&!el.closest('.table-scroll')).map(el=>({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right,text:el.textContent?.slice(0,40)})).slice(0,20)})),null,2)); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('manual snapshot, detail, input validation and isolated login window security',async()=>{
  await seed();const state=await page.evaluate(()=>window.tokenBalance.state());const first=state.accounts[0];
  await page.getByRole('button',{name:'OpenAI / Codex 工作账号 · 演示'}).click();await expect(page.getByRole('dialog')).toContainText('78%');await expect(page.getByRole('dialog')).toContainText('手动快照');
  await page.getByRole('button',{name:'关闭对话框'}).click();
  await page.getByRole('button',{name:'添加账号',exact:true}).click();await page.getByRole('button',{name:'保存账号',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('账号标识');await page.getByRole('button',{name:'取消',exact:true}).click();
  const prefs=await electron.evaluate(({BrowserWindow})=>(BrowserWindow.getAllWindows()[0].webContents as unknown as {getLastWebPreferences:()=>Record<string,unknown>}).getLastWebPreferences());expect(prefs.nodeIntegration).toBe(false);expect(prefs.contextIsolation).toBe(true);expect(prefs.sandbox).toBe(true);
  // A remote window is opened on the explicit test account URL; no credentials are used.
  await page.evaluate(async id=>{try{await window.tokenBalance.login(id);}catch{}},first.id);
  const remotePrefs=await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>!w.webContents.getURL().startsWith('file:')).map(w=>(w.webContents as unknown as {getLastWebPreferences:()=>Record<string,unknown>}).getLastWebPreferences()));
  expect(remotePrefs.length).toBeGreaterThan(0);for(const p of remotePrefs){expect(p.nodeIntegration).toBe(false);expect(p.preload).toBeFalsy();expect(p.sandbox).toBe(true);}
});
test('dynamic webpage extraction and separate account sessions',async()=>{
  const base:Account={...createAccount('custom'),engine:'browser',auth:'session',website:'https://fixture.invalid',infoUrl:'https://fixture.invalid/usage',planPath:'#plan',mappings:[{id:'map-1',label:'动态周额度',period:'week',kind:'remainingPercent',valuePath:'#quota::attr(data-left)',totalPath:'',resetPath:'',unit:'%',scale:1}]};
  await page.evaluate(a=>window.tokenBalance.save(a),{...base,account:'网页账号 A'});await page.evaluate(a=>window.tokenBalance.save(a),{...base,account:'网页账号 B'});
  const accounts=(await page.evaluate(()=>window.tokenBalance.state())).accounts;
  for(const [i,a] of accounts.entries()){
    await electron.evaluate(({session},{id,value,index})=>{session.fromPartition(`persist:account-${id}`).protocol.handle('https',()=>new Response(`<html lang="zh-CN"><body><h1 id="plan">Web Pro</h1><span id="quota" data-left="${value}">quota</span><script>document.cookie='fixture_user=${index}; Secure; Path=/';</script></body></html>`,{headers:{'content-type':'text/html'}}));},{id:a.id,value:i===0?72:15,index:i});
    await page.evaluate(id=>window.tokenBalance.login(id),a.id);
  }
  await page.evaluate(()=>window.tokenBalance.refresh());const refreshed=(await page.evaluate(()=>window.tokenBalance.state())).accounts;
  expect(refreshed.map(a=>a.snapshot?.metrics[0].remainingPercent)).toEqual([72,15]);expect(refreshed.every(a=>a.snapshot?.source==='web')).toBe(true);
  const cookies=await electron.evaluate(async({session},ids)=>Promise.all(ids.map(async id=>(await session.fromPartition(`persist:account-${id}`).cookies.get({url:'https://fixture.invalid'})).find(c=>c.name==='fixture_user')?.value)),accounts.map(a=>a.id));expect(cookies).toEqual(['0','1']);
  const children=electron.windows().filter(p=>p!==page);for(const child of children){expect(await child.evaluate(()=>({node:typeof (window as any).require,bridge:typeof (window as any).tokenBalance}))).toEqual({node:'undefined',bridge:'undefined'});}
});
test('backup UI produces encrypted portable file and imports without overwriting accounts',async()=>{
  await seed();const backupFile=path.join(dataDir,'qa-backup.tbb');
  await electron.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},backupFile);
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('button',{name:'导出加密备份',exact:true}).click();
  await page.getByLabel('备份口令',{exact:true}).fill('qa-password-at-least-10');await page.getByRole('button',{name:'选择保存位置'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(fs.readFileSync(backupFile,'utf8')).not.toContain('工作账号');
  await page.getByRole('button',{name:'导入备份',exact:true}).click();await page.getByLabel('备份口令',{exact:true}).fill('wrong-password');await page.getByRole('button',{name:'选择备份文件'}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('口令错误');
  await page.getByLabel('备份口令',{exact:true}).fill('qa-password-at-least-10');await page.getByRole('button',{name:'选择备份文件'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const s=await page.evaluate(()=>window.tokenBalance.state());expect(s.accounts).toHaveLength(14);expect(new Set(s.accounts.map(a=>a.id)).size).toBe(14);expect(s.accounts[7].snapshot?.source).toBe('manual');
});


