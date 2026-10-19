import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'artifacts/package/win-unpacked');
const temp=path.join(root,'artifacts/native');fs.mkdirSync(temp,{recursive:true});
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const vswhere=path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe');
let vcvars=process.env.TB_VCVARS;
if(!vcvars&&fs.existsSync(vswhere)){
  const install=execFileSync(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();
  if(install)vcvars=path.join(install,'VC/Auxiliary/Build/vcvars64.bat');
}
if(!vcvars)vcvars=path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvars64.bat');
if(!fs.existsSync(vcvars))throw new Error('Install Visual Studio Build Tools C++ (static launcher build only).');
const rc=path.join(temp,'launcher.rc');
fs.writeFileSync(rc,`#pragma code_page(65001)\n#include <windows.h>\n1 ICON "${path.join(root,'assets/icon.ico').replaceAll('\\','/')}"\n1 VERSIONINFO\nFILEVERSION ${version.replaceAll('.',',')},0\nPRODUCTVERSION ${version.replaceAll('.',',')},0\nFILEOS VOS_NT_WINDOWS32\nFILETYPE VFT_APP\nBEGIN\n BLOCK "StringFileInfo"\n BEGIN\n BLOCK "040904b0"\n BEGIN\n VALUE "CompanyName", "123TokenBalance"\n VALUE "FileDescription", "123 Token Balance Startup and Update"\n VALUE "FileVersion", "${version}.0"\n VALUE "ProductName", "123 Token Balance"\n VALUE "ProductVersion", "${version}"\n VALUE "OriginalFilename", "123TokenBalance.exe"\n END\n END\n BLOCK "VarFileInfo"\n BEGIN\n VALUE "Translation", 0x0409, 1200\n END\nEND\n`);
// A fixed build script, no user input is interpolated into executable commands.
const batch=path.join(temp,'build.cmd');
fs.writeFileSync(batch,`@echo off\r\ncall "${vcvars}" >nul\r\nif errorlevel 1 exit /b 1\r\nrc /nologo /fo "${temp}\\launcher.res" "${rc}"\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++17 /utf-8 /EHsc /O2 /MT /W4 /DWIN32_LEAN_AND_MEAN /DNOMINMAX "${root}\\native\\launcher.cpp" "${temp}\\launcher.res" /Fo"${temp}\\launcher.obj" /Fe"${temp}\\123TokenBalance.exe" /link /SUBSYSTEM:WINDOWS /DYNAMICBASE /NXCOMPAT /MANIFEST:EMBED /MANIFESTINPUT:"${root}\\native\\launcher.manifest"\r\nexit /b %errorlevel%\r\n`);
execFileSync(process.env.ComSpec??'cmd.exe',['/d','/c',batch],{stdio:'inherit',cwd:root});
const original=path.join(out,'123TokenBalance.exe'),app=path.join(out,'123TokenBalance.App.exe');
if(!fs.existsSync(app))fs.renameSync(original,app);
fs.copyFileSync(path.join(temp,'123TokenBalance.exe'),original);
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const runtime=files(out).filter(p=>!p.endsWith('runtime-files.txt')&&!p.endsWith('SHA256SUMS.txt')).sort();
fs.writeFileSync(path.join(out,'runtime-files.txt'),runtime.map(p=>`${fs.statSync(p).size}\t${path.relative(out,p).replaceAll('\\','/')}`).join('\n')+'\n');
console.log(`Native static launcher built; ${runtime.length} runtime files indexed.`);
