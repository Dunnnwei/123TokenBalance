import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const name=`123TokenBalance-${pkg.version}-win-x64`,base=path.join(root,'发布'),out=path.join(base,name);
const finalOnly=process.argv.includes('--finalize');
const source=path.join(root,'artifacts/package/win-unpacked');
if(!fs.existsSync(path.join(source,'123TokenBalance.exe')))throw new Error('Run npm run package first.');
fs.mkdirSync(base,{recursive:true});
if(!finalOnly){
  if(fs.existsSync(out))throw new Error('Version directory already exists. Preserve it or choose a new version. Use --finalize only to update documentation and hashes.');
  fs.cpSync(source,out,{recursive:true});
}
if(fs.existsSync(path.join(out,'data')))throw new Error('Release directory contains runtime data; do not publish personal configuration.');
for(const file of ['README.md','CHANGELOG.md','LICENSE'])fs.copyFileSync(path.join(root,file),path.join(out,file));
fs.cpSync(path.join(root,'docs'),path.join(out,'docs'),{recursive:true});
fs.cpSync(path.join(root,'examples'),path.join(out,'examples'),{recursive:true});
const licenseRoot=path.join(out,'licenses');fs.mkdirSync(licenseRoot,{recursive:true});
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const licenseIndex=[];
for(const [rel,entry] of Object.entries(lock.packages)){
  if(!rel||entry.dev)continue;
  const dir=path.join(root,rel);if(!fs.existsSync(path.join(dir,'package.json')))continue;
  const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const dest=path.join(licenseRoot,`${p.name.replace(/[@/]/g,'_')}-${p.version}`);fs.mkdirSync(dest,{recursive:true});
  for(const file of fs.readdirSync(dir))if(/^(licen[sc]e|copying|notice)([._-]|$)/i.test(file)&&fs.statSync(path.join(dir,file)).isFile())fs.copyFileSync(path.join(dir,file),path.join(dest,file));
  licenseIndex.push({name:p.name,version:p.version,license:p.license??entry.license??'See package notices',repository:p.repository??null});
}
const haui=path.join(root,'node_modules/haui');
for(const sub of ['dist/licenses','dist/fonts'])if(fs.existsSync(path.join(haui,sub))){const to=path.join(licenseRoot,'HAUI',path.basename(sub));fs.mkdirSync(to,{recursive:true});for(const file of fs.readdirSync(path.join(haui,sub))){const src=path.join(haui,sub,file);if(fs.statSync(src).isDirectory())fs.cpSync(src,path.join(to,file),{recursive:true});else if(!file.endsWith('.woff2'))fs.copyFileSync(src,path.join(to,file));}}
fs.copyFileSync(path.join(haui,'THIRD_PARTY_NOTICES.md'),path.join(licenseRoot,'HAUI-NOTICES.md'));
fs.writeFileSync(path.join(licenseRoot,'dependencies.json'),JSON.stringify(licenseIndex,null,2));
fs.copyFileSync(path.join(root,'node_modules/electron/LICENSE'),path.join(out,'LICENSE.electron.txt'));
fs.writeFileSync(path.join(out,'VERSION.txt'),`${pkg.version}\nWindows x64 portable\nElectron ${pkg.devDependencies.electron}\nHAUI 0.1.0\n`);
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const entries=files(out).filter(f=>path.basename(f)!=='SHA256SUMS.txt').sort();
fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),entries.map(f=>`${sha(f)}  ${path.relative(out,f).split(path.sep).join('/')}`).join('\n')+'\n');
const zip=path.join(base,`${name}.zip`);
execFileSync('python',[path.join(root,'scripts/zip-release.py'),out,zip],{stdio:'inherit'});
const externalHashes=`${sha(zip)}  ${path.basename(zip)}\n${sha(path.join(out,'123TokenBalance.exe'))}  ${name}/123TokenBalance.exe\n`;
fs.writeFileSync(path.join(base,'SHA256SUMS.txt'),externalHashes);
fs.writeFileSync(path.join(base,`SHA256SUMS-${pkg.version}.txt`),externalHashes);
fs.writeFileSync(path.join(base,'发布说明.txt'),`123 Token Balance ${pkg.version}\n\n上传包：${name}.zip\n便携程序：${name}/123TokenBalance.exe\n请完整解压后运行，保持程序文件夹完整。不要上传自己的 data 文件夹。\n验证与限制详见程序目录 docs/QA_REPORT.md。\n签名：本版本 EXE 未签名。\n`);
console.log(JSON.stringify({directory:out,zip,zipBytes:fs.statSync(zip).size,zipSha256:sha(zip),files:entries.length+1},null,2));
