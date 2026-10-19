import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, AppState } from '../src/core/types';
const call = async (name:string, ...args:unknown[]) => {
  const result = await ipcRenderer.invoke('tb:'+name,...args);
  if(!result.ok) throw new Error(result.error);
  return result.value;
};
const bridge: Bridge = {
  state:()=>call('state'),save:a=>call('save',a),remove:id=>call('remove',id),refresh:ids=>call('refresh',ids),
  login:id=>call('login',id),clearSession:id=>call('clearSession',id),open:url=>call('open',url),settings:s=>call('settings',s),
  preview:(a,s)=>call('preview',a,s),test:a=>call('test',a),exportBackup:p=>call('exportBackup',p),importBackup:p=>call('importBackup',p),
  exportCsv:()=>call('exportCsv'),openData:()=>call('openData'),
  reveal:(id,revision)=>call('reveal',id,revision),copy:text=>call('copy',text),chooseLogo:()=>call('chooseLogo'),move:(id,target)=>call('move',id,target),
  previewConfig:text=>call('previewConfig',text),importConfig:text=>call('importConfig',text),readConfigFile:()=>call('readConfigFile'),
  startCapture:url=>call('startCapture',url),captureInfo:id=>call('captureInfo',id),navigateCapture:(id,url)=>call('navigateCapture',id,url),readCapture:id=>call('readCapture',id),saveCapture:(id,account,plan)=>call('saveCapture',id,account,plan),closeCapture:id=>call('closeCapture',id),focusCapture:id=>call('focusCapture',id),
  subscribeCapture:callback=>{const listener=(_event:unknown,result:import('../src/core/types').CaptureResult)=>callback(result);ipcRenderer.on('tb:capture',listener);return()=>ipcRenderer.removeListener('tb:capture',listener);},
  subscribe:callback=>{const listener=(_event:unknown,state:AppState)=>callback(state);ipcRenderer.on('tb:changed',listener);return()=>ipcRenderer.removeListener('tb:changed',listener);},
};
contextBridge.exposeInMainWorld('tokenBalance',bridge);
