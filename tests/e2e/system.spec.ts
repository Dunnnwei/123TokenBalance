import { test,expect } from '@playwright/test';
import { _electron,type ElectronApplication,type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { REPOSITORY } from '../../src/core/system';
let app:ElectronApplication,page:Page,dataDir:string;
test.beforeEach(async()=>{dataDir=fs.mkdtempSync(path.resolve('artifacts/qa/system-data-'));const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:process.env.TB_EXECUTABLE||path.resolve('node_modules/electron/dist/electron.exe'),args:[...(process.env.TB_EXECUTABLE?[]:[path.resolve('.')]),`--data-dir=${dataDir}`],env:env as Record<string,string>});page=await app.firstWindow();await expect(page.getByRole('heading',{name:'额度总览.'})).toBeVisible();});
test.afterEach(async()=>{await app?.close();});
const metadata=(version:string)=>({draft:false,prerelease:false,tag_name:`v${version}`,html_url:`${REPOSITORY}/releases/tag/v${version}`,body:'测试更新说明',assets:[{name:`123TokenBalance-${version}-win-x64.zip`,size:6,state:'uploaded',digest:'sha256:'+'a'.repeat(64),browser_download_url:`${REPOSITORY}/releases/download/v${version}/123TokenBalance-${version}-win-x64.zip`}]});
test('environment is inspected on startup and includes usable results and log controls',async()=>{
  await expect(page.getByRole('button',{name:'环境检测通过',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'环境检测通过',exact:true}).click();const panel=page.getByRole('dialog');await expect(panel).toContainText('图形兼容');await expect(panel).toContainText('Windows 凭据加密');await expect(panel.getByRole('button',{name:'打开检测日志'})).toBeVisible();
  await panel.getByRole('button',{name:'重新检查'}).click();await expect(panel).toContainText('满足');await page.screenshot({path:'artifacts/qa/environment-1.2.0.png'});
  const s=await page.evaluate(()=>window.tokenBalance.state());expect(s.environment.checks.find(c=>c.id==='encryption')?.status).toBe('pass');expect(s.readOnly).toBe(false);
});
test('latest, available and download-integrity failures appear without exiting the current app',async()=>{
  await app.evaluate((_electron,body)=>{globalThis.fetch=async()=>Response.json(body);},metadata('1.2.0'));
  await page.getByRole('button',{name:'检测新版本',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('status')).toContainText('已是最新');
  await app.evaluate((_electron,body)=>{globalThis.fetch=async()=>Response.json(body);},metadata('1.3.0'));
  await dialog.getByRole('button',{name:'检测新版本',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('发现新版本 1.3.0');await expect(dialog.getByRole('button',{name:'下载并自动更新'})).toBeVisible();
  await app.evaluate(()=>{globalThis.fetch=async()=>new Response('badzip');});await dialog.getByRole('button',{name:'下载并自动更新'}).click();await expect(dialog.getByRole('status')).toContainText('SHA-256');expect((await page.evaluate(()=>window.tokenBalance.state())).version).toBe('1.2.0');await page.screenshot({path:'artifacts/qa/update-integrity-1.2.0.png'});
});
test('offline check shows recovery guidance and the exact GitHub download link',async()=>{
  await app.evaluate(({shell})=>{globalThis.fetch=async()=>{throw new TypeError('fetch failed');};(globalThis as any).opened=[];shell.openExternal=async url=>{(globalThis as any).opened.push(url);};});
  await page.getByRole('button',{name:'检测新版本',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('status')).toContainText('无法连接 GitHub');await dialog.getByRole('button',{name:'在 GitHub 下载'}).click();expect(await app.evaluate(()=>(globalThis as any).opened)).toEqual([`${REPOSITORY}/releases/latest`]);
});
test('unreadable copied accounts can be archived and recovered without losing original bytes',async()=>{
  await app.close();const original='{"version":1,"encrypted":"Zm9yZWlnbi1tYWNoaW5lLWZpeHR1cmU="}';fs.writeFileSync(path.join(dataDir,'accounts.enc.json'),original);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:process.env.TB_EXECUTABLE||path.resolve('node_modules/electron/dist/electron.exe'),args:[...(process.env.TB_EXECUTABLE?[]:[path.resolve('.')]),`--data-dir=${dataDir}`],env:env as Record<string,string>});page=await app.firstWindow();await expect(page.getByRole('button',{name:'查看换机恢复方案'})).toBeVisible();
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await page.getByRole('button',{name:'查看换机恢复方案'}).click();await page.getByRole('button',{name:'归档旧配置并恢复',exact:true}).click();await expect(page.getByRole('heading',{name:'导入口令加密备份'})).toBeVisible();
  const next=await page.evaluate(()=>window.tokenBalance.state());expect(next.readOnly).toBe(false);expect(next.accounts).toHaveLength(0);const archive=fs.readdirSync(dataDir).find(n=>n.startsWith('recovery-'))!;expect(fs.readFileSync(path.join(dataDir,archive,'accounts.enc.json'),'utf8')).toBe(original);expect(fs.readFileSync(path.join(dataDir,'accounts.enc.json'),'utf8')).not.toBe(original);
});
