import { createHash } from 'node:crypto';
// Minimal stored ZIP writer used to construct malicious archive fixtures as well as valid ones.
export function zipFixture(entries:{name:string;content:Buffer|string;attributes?:number}[]):Buffer {
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const entry of entries){
    const name=Buffer.from(entry.name),data=Buffer.from(entry.content);let crc=0xffffffff;
    for(const value of data){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
    local.push(h,name,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(entry.attributes??0,38);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+data.length;
  }
  const table=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(table.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,table,end]);
}
export function releaseFixture(version='1.3.0',alter?:(entries:{name:string;content:string}[])=>void):Buffer {
  const root=`123TokenBalance-${version}-win-x64`;
  const files=[{name:'123TokenBalance.exe',content:'native-launcher-fixture'},{name:'123TokenBalance.App.exe',content:'app-fixture'},{name:'resources/app.asar',content:'app-resources-fixture'},{name:'runtime-files.txt',content:'runtime-fixture'},{name:'VERSION.txt',content:version+'\nWindows x64 portable\n'}];
  const manifest=files.map(file=>`${createHash('sha256').update(file.content).digest('hex')}  ${file.name}`).join('\n')+'\n';
  files.push({name:'SHA256SUMS.txt',content:manifest});alter?.(files);
  return zipFixture(files.map(e=>({...e,name:`${root}/${e.name}`})));
}
