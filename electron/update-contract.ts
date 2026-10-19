import type { ReleaseCandidate } from '../src/core/system';
import { REPOSITORY } from '../src/core/system';
export const MAX_ZIP_BYTES=600*1024*1024;
export function versionParts(value:unknown):number[]{
  if(typeof value!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value))throw new Error('版本号格式无效。');
  const parts=value.split('.');if(parts.some(x=>x.length>1&&x.startsWith('0')))throw new Error('版本号格式无效。');return parts.map(Number);
}
export function newer(candidate:string,current:string):boolean {
  const a=versionParts(candidate),b=versionParts(current);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;
}
export function releaseCandidate(value:unknown,current:string):ReleaseCandidate|null {
  const r=value as Record<string,unknown>;if(!r||r.draft!==false||r.prerelease!==false||typeof r.tag_name!=='string')throw new Error('GitHub 未返回可用的正式版本。');
  const version=r.tag_name.replace(/^v/,'');versionParts(version);if(!newer(version,current))return null;
  const tag=`v${version}`,name=`123TokenBalance-${version}-win-x64.zip`,url=`${REPOSITORY}/releases/tag/${tag}`,assetUrl=`${REPOSITORY}/releases/download/${tag}/${name}`;
  if(r.tag_name!==tag||r.html_url!==url||!Array.isArray(r.assets))throw new Error('发布来源或版本标签不匹配。');
  const assets=r.assets.filter((a:Record<string,unknown>)=>a.name===name);if(assets.length!==1)throw new Error('此版本没有唯一的 Windows x64 完整包，请前往仓库查看。');
  const a=assets[0];if(a.state!=='uploaded'||a.browser_download_url!==assetUrl||!Number.isSafeInteger(a.size)||a.size<1||a.size>MAX_ZIP_BYTES||typeof a.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(a.digest))throw new Error('更新包大小、地址或 GitHub SHA-256 摘要无效，未允许自动更新。');
  return{version,tag,url,assetUrl,assetName:name,bytes:a.size,sha256:a.digest.slice(7),notes:typeof r.body==='string'?r.body.slice(0,6000):''};
}
export function safeArchivePath(entry:string,rootName:string):string|null {
  if(!entry.startsWith(rootName+'/'))throw new Error('ZIP 顶层目录与版本不匹配。');
  const rel=entry.slice(rootName.length+1);if(!rel)return null;
  if(rel.includes('\\')||/[\x00-\x1f:]/.test(rel)||rel.startsWith('/'))throw new Error('ZIP 含不安全路径。');
  const parts=rel.replace(/\/$/,'').split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw new Error('ZIP 路径不适用于 Windows。');
  if(parts.some(p=>['data','.git','node_modules'].includes(p.toLowerCase())))throw new Error('ZIP 不应包含用户数据或开发目录。');
  if(rel.length>220)throw new Error('ZIP 路径过长。');
  return parts.join('/');
}
