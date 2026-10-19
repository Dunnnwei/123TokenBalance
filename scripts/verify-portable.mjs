import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'artifacts/package/win-unpacked');
const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const qa = path.join(root, 'artifacts/qa');
const base = fs.mkdtempSync(path.join(qa, 'portable-'));
const before = path.join(base, '首次启动');
const after = path.join(base, '移动后的程序 Token Balance');
fs.cpSync(source, before, { recursive: true });
assert(!fs.existsSync(path.join(before, 'data')), 'Package must not contain runtime data');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
let application;
async function launch(folder) {
  application = await _electron.launch({ executablePath: path.join(folder, '123TokenBalance.App.exe'), args: [], cwd: folder, env });
  const page = await application.firstWindow();
  await page.getByRole('heading', { name: '额度总览.' }).waitFor();
  const state = await page.evaluate(() => window.tokenBalance.state());
  assert.equal(state.version, version);
  assert.equal(state.secureStorage, true);
  assert.equal(path.resolve(state.dataPath), path.join(folder, 'data'));
  return { page, state };
}
try {
  const first = await launch(before);
  assert.equal(first.state.accounts.length, 0);
  await first.page.evaluate(() => window.tokenBalance.settings({ intervalMinutes: 0, lowThreshold: 20, privacy: false }));
  await first.page.getByRole('button', { name: '添加账号', exact: true }).first().click();
  await first.page.getByRole('combobox', { name: '平台模板' }).click();
  await first.page.getByRole('option', { name: 'DeepSeek', exact: true }).click();
  await first.page.getByLabel('账号标识 *').fill('portable-qa@example.invalid');
  await first.page.getByLabel('API Key / OAuth Access Token', { exact: true }).fill('dummy-portable-secret');
  await first.page.getByRole('switch', { name: '参与全部刷新' }).click();
  await first.page.getByRole('button', { name: '保存账号', exact: true }).click();
  await first.page.getByRole('dialog').waitFor({ state: 'hidden' });
  const saved = await first.page.evaluate(() => window.tokenBalance.state());
  assert.equal(saved.accounts.length, 1);
  assert.equal(saved.accounts[0].enabled, false);
  assert.equal(saved.accounts[0].hasSecret, true);
  const encrypted = fs.readFileSync(path.join(before, 'data/accounts.enc.json'), 'utf8');
  assert(!encrypted.includes('dummy-portable-secret'));
  assert(!encrypted.includes('portable-qa@example.invalid'));
  await application.close(); application = undefined;

  // Both resolved paths are siblings under this newly created QA directory.
  assert.equal(path.dirname(before), base); assert.equal(path.dirname(after), base);
  // Chromium child processes and Windows scanners may briefly retain file handles.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(before, after); break; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 20) throw error;
      await delay(250);
    }
  }
  const moved = await launch(after);
  assert.equal(moved.state.accounts.length, 1);
  assert.equal(moved.state.accounts[0].id, saved.accounts[0].id);
  assert.equal(moved.state.accounts[0].account, 'portable-qa@example.invalid');
  assert.equal(moved.state.accounts[0].hasSecret, true);
  assert.equal(moved.state.settings.intervalMinutes, 0);
  const report = { result: 'passed', version: moved.state.version, executable: path.join(after, '123TokenBalance.exe'), restrictedPath: env.PATH, defaultDataBesideExe: true, initiallyEmpty: true, retainedAccountAfterMove: true, sameAccountId: true, dpapiAvailable: true, noPlaintextSecretOnDisk: true, externalNodePythonDotnetNeeded: false, realAccountOrNetworkUsed: false };
  fs.writeFileSync(path.join(qa, 'portable-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (application) await application.close();
}
