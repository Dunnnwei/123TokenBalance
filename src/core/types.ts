export type Period = '5h' | 'week' | 'month' | 'day' | 'balance' | 'other';
export type Engine = 'preset' | 'json' | 'html' | 'browser' | 'manual';
export type Auth = 'none' | 'bearer' | 'api-key' | 'cookie' | 'session';
export type ValueKind = 'remainingPercent' | 'usedPercent' | 'remaining' | 'used' | 'value';
export interface MetricMapping {
  id: string; label: string; period: Period; valuePath: string; totalPath: string;
  resetPath: string; kind: ValueKind; unit: string; scale: number;
  extract?: 'number' | 'percent' | 'ratio-first'; totalExtract?: 'ratio-last';
}
export interface Metric {
  label: string; period: Period; unit: string; remaining?: number; total?: number;
  remainingPercent?: number; value?: number; resetsAt?: string;
}
export interface Snapshot {
  plan: string; planSource: 'api' | 'config' | 'unknown'; metrics: Metric[];
  fetchedAt: string; source: 'api' | 'web' | 'manual'; note?: string;
}
export interface Account {
  appearance?: AccountAppearance;
  subscription?: SubscriptionRecord;
  browserAutoRefresh?: boolean;
  id: string; revision: number; providerId: string; platformName: string; account: string;
  website: string; infoUrl: string; engine: Engine; endpoint: string; method: 'GET' | 'POST';
  auth: Auth; secret: string; authHeader: string; headers: string; body: string;
  plan: string; planPath: string; mappings: MetricMapping[]; enabled: boolean;
  manual?: Snapshot; snapshot?: Snapshot; status: 'idle' | 'refreshing' | 'ok' | 'error';
  error?: string; checkedAt?: string; retryAt?: string;
  hasSecret?: boolean; hasHeaders?: boolean; preserveSecret?: boolean; preserveHeaders?: boolean;
}
export type LogoSource = {kind:'builtin';name:string} | {kind:'image';dataUrl:string} | {kind:'none'};
export interface SubscriptionRecord {startedOn:string;renewsOn:string;cycle:'monthly'|'yearly'|'custom';remindDays:number;}
export interface AccountAppearance {logo?:LogoSource;backgroundLogo?:LogoSource;backgroundOpacity?:number;}
export const LOGO_NAMES:Record<string,string>={openai:'OpenAI',claude:'Claude',gemini:'Gemini',deepseek:'DeepSeek',zhipu:'智谱',zai:'Z.ai',minimax:'MiniMax',kimi:'Kimi',moonshot:'Moonshot',siliconcloud:'硅基流动',openrouter:'OpenRouter',volcengine:'火山方舟',alibabacloud:'阿里云百炼',tencent:'腾讯云',cursor:'Cursor',githubcopilot:'GitHub Copilot'};
export interface Settings { intervalMinutes: number; lowThreshold: number; privacy: boolean; }
export interface StoreData { schema: 1; accounts: Account[]; settings: Settings; }
export interface AppState extends StoreData { version: string; dataPath: string; secureStorage: boolean; warnings: string[]; }
export interface Provider {
  id: string; name: string; region: string; engine: Engine; endpoint: string; website: string;
  infoUrl: string; auth: Auth; method?: 'GET' | 'POST'; body?: string; headers?: string;
  description: string; docs: string; support: 'adapter' | 'web' | 'custom';
}
export interface Bridge {
  state(): Promise<AppState>;
  save(account: Account): Promise<AppState>;
  remove(id: string): Promise<AppState>;
  refresh(ids?: string[]): Promise<AppState>;
  login(id: string): Promise<void>;
  clearSession(id: string): Promise<void>;
  open(url: string): Promise<void>;
  settings(settings: Settings): Promise<AppState>;
  preview(account: Account, sample: string): Promise<Snapshot>;
  test(account: Account): Promise<Snapshot>;
  exportBackup(password: string): Promise<boolean>;
  importBackup(password: string): Promise<AppState | null>;
  exportCsv(): Promise<boolean>;
  openData(): Promise<void>;
  reveal(id: string, revision: number): Promise<{secret: string; headers: string}>;
  copy(text: string): Promise<void>;
  chooseLogo(): Promise<string | null>;
  move(id: string, targetId: string): Promise<AppState>;
  previewConfig(text: string): Promise<Account[]>;
  importConfig(text: string): Promise<AppState>;
  readConfigFile(): Promise<string | null>;
  startCapture(url: string): Promise<string>;
  captureInfo(id: string): Promise<CaptureInfo>;
  navigateCapture(id: string, url: string): Promise<void>;
  readCapture(id: string): Promise<CaptureResult>;
  saveCapture(id: string, account: string, plan: string): Promise<AppState>;
  closeCapture(id: string): Promise<void>;
  focusCapture(id: string): Promise<void>;
  subscribeCapture(callback: (result: CaptureResult) => void): () => void;
  subscribe(callback: (state: AppState) => void): () => void;
}
export interface PageField { text: string; context: string; selector: string; attribute?: string; tag?: string; }
export interface PageScan { url: string; title: string; fields: PageField[]; }
export interface CaptureInfo { url: string; title: string; loading: boolean; }
export interface CaptureResult { id: string; draft: Account; snapshot: Snapshot; evidence: string[]; warnings: string[]; }
export const PERIODS: Record<Period, string> = { '5h': '5 小时', week: '周额度', month: '月额度', day: '日额度', balance: '账户金额', other: '其他额度' };
export const DEFAULT_SETTINGS: Settings = { intervalMinutes: 15, lowThreshold: 20, privacy: false };
