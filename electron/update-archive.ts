import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { safeArchivePath } from './update-contract';

const MAX_TOTAL=1500*1024*1024,MAX_FILES=4000;
export async function fileHash(file:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk as Buffer);return hash.digest('hex');}
export async function extractUpdate(zipPath:string,stage:string,rootName:string):Promise<string>{
  if((await fsp.readdir(stage)).length)throw new Error('更新临时目录必须为空。');
  const zip=await new Promise<yauzl.ZipFile>((resolve,reject)=>yauzl.open(zipPath,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value!)));
  const names=new Set<string>(),files=new Map<string,string>();let total=0,count=0;
  try{
    await new Promise<void>((resolve,reject)=>{
      let done=false;const fail=(e:unknown)=>{if(!done){done=true;zip.close();reject(e);}};
      zip.on('error',fail);zip.on('end',()=>{if(!done){done=true;resolve();}});
      zip.on('entry',(entry:yauzl.Entry)=>{void(async()=>{
        if(++count>MAX_FILES)throw new Error('更新包文件数量过多。');
        const rel=safeArchivePath(entry.fileName,rootName);
        if(!rel){zip.readEntry();return;}
        const key=rel.toLowerCase();if(names.has(key))throw new Error('ZIP 含重复或大小写冲突路径。');names.add(key);
        const mode=(entry.externalFileAttributes>>>16)&0xf000;
        if(mode===0xa000||mode&&mode!==0x8000&&mode!==0x4000||(entry.generalPurposeBitFlag&1))throw new Error('ZIP 不允许链接、特殊文件或加密条目。');
        if(entry.uncompressedSize>MAX_TOTAL||(total+=entry.uncompressedSize)>MAX_TOTAL)throw new Error('更新包展开体积超过限制。');
        const target=path.join(stage,rel);
        if(entry.fileName.endsWith('/')){await fsp.mkdir(target,{recursive:true});zip.readEntry();return;}
        await fsp.mkdir(path.dirname(target),{recursive:true});
        const stream=await new Promise<NodeJS.ReadableStream>((res,rej)=>zip.openReadStream(entry,(e,s)=>e?rej(e):res(s!)));
        let actual=0;const hash=createHash('sha256');
        const guard=new Transform({transform(chunk:Buffer,_encoding,callback){actual+=chunk.length;if(actual>entry.uncompressedSize||actual>MAX_TOTAL){callback(new Error('ZIP 实际体积与声明不符。'));return;}hash.update(chunk);callback(null,chunk);}});
        await pipeline(stream,guard,fs.createWriteStream(target,{flags:'wx'}));
        if(actual!==entry.uncompressedSize)throw new Error('ZIP 文件长度不符。');files.set(rel,hash.digest('hex'));zip.readEntry();
      })().catch(fail);});zip.readEntry();
    });
  }finally{zip.close();}
  const manifestFile=path.join(stage,'SHA256SUMS.txt');
  if(!files.has('SHA256SUMS.txt')||(await fsp.stat(manifestFile)).size>4*1024*1024)throw new Error('更新包缺少完整文件校验清单。');
  const manifest=await fsp.readFile(manifestFile,'utf8'),listed=new Set<string>();
  for(const line of manifest.trim().split(/\r?\n/)){
    const match=/^([a-f0-9]{64})  (.+)$/.exec(line);if(!match)throw new Error('文件校验清单格式错误。');
    const rel=safeArchivePath(`${rootName}/${match[2]}`,rootName);if(!rel||listed.has(rel.toLowerCase())||files.get(rel)!==match[1])throw new Error('更新包文件哈希不一致。');listed.add(rel.toLowerCase());
  }
  if(listed.size!==files.size-1||listed.has('sha256sums.txt'))throw new Error('更新包存在未列入校验清单的文件。');
  for(const required of ['123TokenBalance.exe','123TokenBalance.App.exe','resources/app.asar','runtime-files.txt','VERSION.txt'])if(!files.has(required))throw new Error(`更新包缺少 ${required}。`);
  const version=rootName.replace(/^123TokenBalance-/,'').replace(/-win-x64$/,'');
  if((await fsp.readFile(path.join(stage,'VERSION.txt'),'utf8')).split(/\r?\n/)[0]!==version)throw new Error('包内版本与 GitHub 版本不一致。');
  return files.get('SHA256SUMS.txt')!;
}
