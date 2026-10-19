export const REPOSITORY = 'https://github.com/Dunnnwei/123TokenBalance';
export const RELEASES_URL = `${REPOSITORY}/releases/latest`;
export const RELEASES_API = 'https://api.github.com/repos/Dunnnwei/123TokenBalance/releases/latest';
export interface EnvironmentCheck { id:string; label:string; status:'pass'|'warn'|'fail'; detail:string; url?:string; }
export interface EnvironmentReport { checkedAt:string; durationMs:number; checks:EnvironmentCheck[]; logPath:string; }
export interface ReleaseCandidate { version:string; tag:string; url:string; assetUrl:string; assetName:string; bytes:number; sha256:string; notes:string; }
export interface UpdateState {
  phase:'idle'|'checking'|'latest'|'available'|'downloading'|'verifying'|'ready'|'installing'|'error';
  currentVersion:string; candidate?:ReleaseCandidate; progress:number; message:string; repositoryUrl:string;
}
