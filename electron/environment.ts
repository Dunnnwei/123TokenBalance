import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import type { EnvironmentCheck,EnvironmentReport } from '../src/core/system';
import { RELEASES_URL } from '../src/core/system';

export function probeWritable(dir:string):boolean {
  let probe='';
  try {fs.mkdirSync(dir,{recursive:true});probe=path.join(dir,`.probe-${randomUUID()}`);const fd=fs.openSync(probe,'wx');fs.closeSync(fd);fs.unlinkSync(probe);return true;}catch{return false;}
}
export function resolveDataPath(root:string,override:string|undefined,local:string):{dataPath:string;fallback:boolean} {
  const requested=override?path.resolve(override):path.join(root,'data');
  if(probeWritable(requested))return{dataPath:requested,fallback:false};
  if(override)throw new Error('指定的数据目录不可写，请选择当前用户可写目录。');
  const fallback=path.join(local,'123TokenBalance',`portable-${createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,16)}`);
  if(!probeWritable(fallback))throw new Error('程序文件夹和用户数据目录均不可写。');
  return{dataPath:fallback,fallback:true};
}
export function startupArgument(argv:string[],name:'report'|'ready',local:string):string|undefined {
  const value=argv.find(a=>a.startsWith(`--startup-${name}=`))?.split('=').slice(1).join('=');
  if(!value)return;
  const resolved=path.resolve(value),dir=path.join(local,'123TokenBalance','logs');
  if(path.dirname(resolved).toLowerCase()!==dir.toLowerCase()||!/^startup-[\d-]+\.(tsv|ready)$/.test(path.basename(resolved)))return;
  return resolved;
}
export function environmentReport(input:{root:string;dataPath:string;packaged:boolean;secure:boolean;readOnly:boolean;fallback:boolean;nativeReport?:string;logPath:string}):EnvironmentReport {
  const start=performance.now();const checks:EnvironmentCheck[]=[];
  if(input.nativeReport){try{if(fs.statSync(input.nativeReport).size<=128*1024){for(const row of fs.readFileSync(input.nativeReport,'utf8').trim().split(/\r?\n/)){const[status,id,label,detail,url]=row.split('\t');if(['pass','warn','fail'].includes(status)&&id&&label&&detail)checks.push({status:status as EnvironmentCheck['status'],id,label,detail,url:url||undefined});}}}catch{}}
  if(!checks.length){
    const supported=process.platform==='win32'&&Number(os.release().split('.')[2])>=19041;
    checks.push({id:'os',label:'操作系统',status:supported?'pass':'warn',detail:`${os.type()} ${os.release()} / ${process.arch}；发布目标 Windows 10 build 19041+ 或 Windows 11 x64`,url:'https://www.microsoft.com/software-download/windows11'});
    checks.push({id:'runtime',label:'内置运行环境',status:'pass',detail:'Chromium 与 Node 随程序提供，无需安装 .NET / WebView2 / VC 运行库'});
  }
  checks.push({id:'storage',label:'当前数据位置',status:input.fallback?'warn':'pass',detail:input.dataPath+(input.fallback?'（程序目录不可写，已切换当前用户目录）':'')});
  checks.push({id:'graphics',label:'图形兼容',status:'pass',detail:'已启用软件渲染，减少跨显卡驱动启动问题'});
  checks.push({id:'encryption',label:'Windows 凭据加密',status:input.secure?'pass':'fail',detail:input.secure?'本机加密服务可用':'系统加密服务不可用，无法安全保存账号。请检查当前 Windows 用户登录环境。'});
  checks.push({id:'accounts',label:'账号文件',status:input.readOnly?'warn':'pass',detail:input.readOnly?'旧配置无法正常解密或损坏，已保护原文件。请使用下方“归档旧配置并恢复”后导入口令备份。':'本地账号可读，或尚未添加账号'});
  if(input.packaged&&!fs.existsSync(path.join(input.root,'123TokenBalance.exe')))checks.push({id:'launcher',label:'启动检测器',status:'fail',detail:'原生启动器缺失，请重新下载完整程序包。',url:RELEASES_URL});
  return{checkedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-start),checks,logPath:input.nativeReport??input.logPath};
}
