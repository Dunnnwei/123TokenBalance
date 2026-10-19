import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import type { UpdateState } from '../src/core/system';
import { REPOSITORY,RELEASES_API } from '../src/core/system';
import { releaseCandidate } from './update-contract';
import { extractUpdate } from './update-archive';
import { probeWritable } from './environment';

type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
const defaultFetch:Fetcher=(url,init)=>fetch(url,init);
export async function githubFetch(url:string,signal:AbortSignal,fetcher:Fetcher=defaultFetch):Promise<Response>{
  for(let redirects=0;redirects<5;redirects++){
    const u=new URL(url);
    if(u.protocol!=='https:'||u.username||u.password||u.port||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw new Error('更新下载重定向到了不受信任的地址。');
    const response=await fetcher(url,{redirect:'manual',signal,headers:{'User-Agent':'123TokenBalance-Updater','Accept':u.hostname==='api.github.com'?'application/vnd.github+json':'application/octet-stream'}});
    if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw new Error('下载重定向缺少地址。');url=new URL(next,url).href;continue;}
    return response;
  }throw new Error('GitHub 下载重定向次数过多。');
}
export class Updater {
  state:UpdateState;
  private busy=false;private prepared?:{stage:string;manifest:string};
  constructor(private options:{version:string;root:string;dataPath:string;local:string;packaged:boolean;notify:(s:UpdateState)=>void;install:(helper:string,args:string[])=>Promise<void>;fetcher?:Fetcher}){
    this.state={phase:'idle',currentVersion:options.version,progress:0,message:'点击检测 GitHub 最新正式版本。',repositoryUrl:REPOSITORY};
  }
  private set(patch:Partial<UpdateState>){this.state={...this.state,...patch};this.options.notify({...this.state});return this.state;}
  async check():Promise<UpdateState>{
    if(this.busy||this.state.phase==='ready'||this.state.phase==='installing')return this.state;this.busy=true;this.set({phase:'checking',candidate:undefined,message:'正在查询 GitHub 最新正式版本…',progress:0});
    try{
      const response=await githubFetch(RELEASES_API,AbortSignal.timeout(15000),this.options.fetcher);
      if(!response.ok){await response.body?.cancel();throw new Error(response.status===404?'仓库暂未发布正式版本，可前往仓库查看。':response.status===403||response.status===429?'GitHub 请求受限，请稍后重试或到仓库下载。':`GitHub 检查失败（HTTP ${response.status}）。`);}
      if(!response.body)throw new Error('GitHub 返回空响应。');const chunks:Uint8Array[]=[];let bytes=0;
      for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){bytes+=chunk.length;if(bytes>1024*1024)throw new Error('GitHub 发布信息超过限制。');chunks.push(chunk);}
      const candidate=releaseCandidate(JSON.parse(Buffer.concat(chunks).toString('utf8')),this.options.version);
      return this.set(candidate?{phase:'available',candidate,message:`发现新版本 ${candidate.version}，下载后自动校验并更新。`}:{phase:'latest',message:`当前 ${this.options.version} 已是最新正式版本。`});
    }catch(e){return this.set({phase:'error',message:this.message(e)});}finally{this.busy=false;}
  }
  private message(e:unknown):string{
    if(e instanceof Error&&['TimeoutError','AbortError'].includes(e.name))return '连接 GitHub 超时，请检查网络后重试，或前往仓库手动下载。';
    if(e instanceof Error&&e.message==='fetch failed')return '无法连接 GitHub，请检查网络或代理，或前往仓库手动下载。';
    return e instanceof Error?e.message.slice(0,500):'更新失败，原程序和数据未修改。';
  }
  async download():Promise<UpdateState>{
    if(this.busy)return this.state;if(this.prepared)return this.state;
    const candidate=this.state.candidate;if(!candidate)return this.set({phase:'error',message:'请先检测新版本。'});
    this.busy=true;let stage='',downloadDir='';
    try{
      const {root,dataPath,packaged}=this.options;
      if(!packaged)throw new Error('自动更新只在正式便携包中提供。');
      const relative=path.relative(root,dataPath);if(!relative||relative&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)&&relative!=='data')throw new Error('自定义数据目录位于程序内部，请在仓库下载新版并手动迁移。');
      const parent=path.dirname(root);if(root===parent||root.startsWith('\\\\')||!probeWritable(parent))throw new Error('程序所在目录不支持安全替换，请移到当前用户可写的本地文件夹，或使用仓库手动下载。');
      for(const dir of [root,parent,dataPath])if((await fsp.lstat(dir)).isSymbolicLink())throw new Error('链接目录不支持自动更新，请使用普通本地目录。');
      const disk=await fsp.statfs(parent);if(disk.bavail*disk.bsize<Math.max(candidate.bytes*5,1800*1024*1024))throw new Error('更新需要至少 1.8 GB 可用磁盘空间，以保留原版并验证新包。');
      const cache=path.join(this.options.local,'123TokenBalance','updates');await fsp.mkdir(cache,{recursive:true});downloadDir=await fsp.mkdtemp(path.join(cache,'download-'));
      const zip=path.join(downloadDir,'release.zip');this.set({phase:'downloading',message:'正在从 GitHub 下载完整更新包…',progress:0});
      const response=await githubFetch(candidate.assetUrl,AbortSignal.timeout(10*60000),this.options.fetcher);
      if(!response.ok||!response.body){await response.body?.cancel();throw new Error(`下载失败（HTTP ${response.status}）。`);}
      const length=response.headers.get('content-length');if(length&&Number(length)!==candidate.bytes){await response.body.cancel();throw new Error('下载长度与 GitHub 记录不匹配。');}
      const handle=await fsp.open(zip,'wx'),hash=createHash('sha256');let received=0,last=0;
      try{for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){received+=chunk.length;if(received>candidate.bytes)throw new Error('下载体积超过 GitHub 声明。');hash.update(chunk);await handle.writeFile(Buffer.from(chunk));const percent=Math.floor(received/candidate.bytes*100);if(percent!==last){last=percent;this.set({progress:percent});}}await handle.sync();}finally{await handle.close();}
      if(received!==candidate.bytes||hash.digest('hex')!==candidate.sha256)throw new Error('更新 ZIP 的 SHA-256 校验失败，原程序未修改。');
      this.set({phase:'verifying',message:'下载完成，正在安全解压并逐文件校验…',progress:100});
      stage=await fsp.mkdtemp(path.join(parent,'.123TokenBalance-update-'));
      const manifest=await extractUpdate(zip,stage,`123TokenBalance-${candidate.version}-win-x64`);
      this.prepared={stage,manifest};stage='';return this.set({phase:'ready',message:'更新包已通过校验，正在准备重启。旧版本将保留为备份。'});
    }catch(e){return this.set({phase:'error',message:this.message(e)});}finally{
      if(stage)await fsp.rm(stage,{recursive:true,force:true}).catch(()=>{});
      if(downloadDir)await fsp.rm(downloadDir,{recursive:true,force:true}).catch(()=>{});this.busy=false;
    }
  }
  async install():Promise<UpdateState>{
    if(this.busy||!this.prepared||this.state.phase!=='ready')return this.state;this.busy=true;
    try{
      const dir=path.join(this.options.local,'123TokenBalance','updates',`helper-${randomUUID()}`);await fsp.mkdir(dir,{recursive:true});
      const helper=path.join(dir,'123TokenBalance.Update.exe');await fsp.copyFile(path.join(this.options.root,'123TokenBalance.exe'),helper,fs.constants.COPYFILE_EXCL);
      this.set({phase:'installing',message:'即将关闭本窗口并应用更新，原版和数据会保留。'});
      await this.options.install(helper,['--apply-update',this.options.root,this.prepared.stage,String(process.pid),this.options.dataPath,this.prepared.manifest]);
      return this.state;
    }catch(e){return this.set({phase:'error',message:this.message(e)});}finally{this.busy=false;}
  }
}
