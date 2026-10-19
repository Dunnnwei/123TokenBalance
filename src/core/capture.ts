import type { PageScan, PageField, CaptureResult, Period, MetricMapping } from './types';
import { createAccount, PROVIDERS } from './providers';
import { AppError, safeUrl } from './validation';
import { extractedNumber, mappedSnapshot } from './parse';

const periodOf = (s: string): Period => /5\s*(?:小时|hours?|hrs?|h\b)|five.hour/i.test(s) ? '5h'
  : /(?:每|本|当)?周|weekly|per week|7.day|seven.day/i.test(s) ? 'week'
  : /(?:每|本|当)?月|monthly|per month/i.test(s) ? 'month'
  : /每日|当天|今日|日额度|daily|per day/i.test(s) ? 'day' : 'other';
const remaining = /剩余|可用|余额|remaining|available|\bleft\b|balance/i;
const used = /已用|已使用|已消耗|已耗|使用了|used|consumed|utilization/i;
const labels: Record<Period, string> = {'5h':'5 小时额度',week:'周额度',month:'月额度',day:'日额度',balance:'账户余额',other:'其他额度'};

export function detectProvider(url: string): string {
  const host = safeUrl(url).hostname.toLowerCase();
  const domains: [string,string[]][] = [
    ['codex',['chatgpt.com','openai.com']],['claude-web',['claude.ai','anthropic.com']],['gemini-web',['gemini.google.com','aistudio.google.com']],
    ['deepseek',['deepseek.com']],['zhipu',['bigmodel.cn']],['zai',['z.ai']],['minimax-cn',['minimaxi.com']],['minimax',['minimax.io']],
    ['kimi-code',['kimi.com']],['moonshot-cn',['moonshot.cn']],['moonshot',['moonshot.ai']],['siliconflow',['siliconflow.cn']],
    ['openrouter',['openrouter.ai']],['ark',['volcengine.com']],['aliyun',['aliyun.com']],['tencent',['tencent.com']],['cursor',['cursor.com']],['github',['github.com']],
  ];
  return domains.find(([,domains])=>domains.some(d=>host===d||host.endsWith('.'+d)))?.[0]??'custom';
}

/** Local, deterministic interpretation; page text never becomes an instruction or code. */
export function recognizePage(scan: PageScan, id: string): CaptureResult {
  const url = safeUrl(scan.url), providerId = detectProvider(scan.url);
  const draft = {...createAccount(providerId), browserAutoRefresh:true, engine:'browser' as const, auth:'session' as const, endpoint:'', website:url.origin, infoUrl:url.href, headers:'', body:''};
  if(providerId==='custom')draft.platformName=scan.title.split(/[|｜—]/)[0].trim().slice(0,80)||url.hostname;
  const fields = scan.fields.slice(0,2500), values = new Map<string,string>(), evidence: string[] = [], warnings: string[] = [];
  const accountField=fields.find(f=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(f.text));
  draft.account=accountField?.text.slice(0,200)??'';
  const planFields=[...fields].sort((a,b)=>a.text.length-b.text.length);
  const planField=planFields.find(f=>f.text.length<70&&!/升级|upgrade|购买|buy|\$|¥|￥|价格|price/i.test(f.context)&&/套餐|当前订阅|current plan|your plan|subscription|membership/i.test(f.context)&&/pro|plus|max|team|enterprise|ultra|premium|standard|basic|free|moderato|allegro|andante|会员|专业版|基础版|旗舰版|免费版|企业版/i.test(f.text))
    ??planFields.find(f=>f.text.length<40&&/^(?:ChatGPT |Claude |Gemini |Kimi |Coding )?(?:Pro|Plus|Max|Team|Enterprise|Ultra|Premium|Standard|Basic|Free|Moderato|Allegro|Andante)(?:\s+\d+x)?$/i.test(f.text)&&!/升级|upgrade|购买|buy/i.test(f.context));
  if(planField){draft.plan=planField.text;draft.planPath=planField.selector;values.set(planField.selector,planField.text);}
  const seen = new Set<string>();
  for(const field of fields){
    if(draft.mappings.length>=30)break;
    if(!field.selector||field.selector.length>480||field.text.length>160)continue;
    const context=field.context.slice(0,700), own=field.text;
    if(/升级|购买套餐|upgrade|pricing|choose a plan|buy now/i.test(context))continue;
    const reportedPeriod=periodOf(context),period=reportedPeriod==='other'&&['codex','claude-web'].includes(providerId)&&/current session|当前会话/i.test(context)?'5h':reportedPeriod, isRemaining=remaining.test(own)||(!used.test(own)&&remaining.test(context)), isUsed=used.test(own)||(!remaining.test(own)&&used.test(context));
    const percent=extractedNumber(own,'percent');
    let mapping:MetricMapping|undefined;
    const common={id:`capture-${draft.mappings.length}`,label:labels[period],period,valuePath:field.selector,totalPath:'',resetPath:'',unit:'%',scale:1};
    if(percent!==undefined&&percent>=0&&percent<=100&&(isRemaining!==isUsed)&&(/额度|用量|限制|剩余|quota|usage|limit|remaining|left|session/i.test(context)||period!=='other')){
      mapping={...common,kind:isUsed?'usedPercent':'remainingPercent',extract:'percent'};
    }else if(percent===undefined){
      const ratio=extractedNumber(own,'ratio-first'),total=extractedNumber(own,'ratio-last');
      const unit=/tokens?|令牌/i.test(context)?'tokens':/积分|credits?|点数/i.test(context)?'点':/requests?|次|prompts?|messages?/i.test(context)?'次':'';
      if(ratio!==undefined&&total!==undefined&&total>0&&(isRemaining!==isUsed)&&unit){
        mapping={...common,unit,kind:isUsed?'used':'remaining',totalPath:field.selector,extract:'ratio-first',totalExtract:'ratio-last'};
      }else{
        const number=extractedNumber(own,'number');
        if(number===undefined)continue;
        const currency=/USD|\$|美元/i.test(own)?'USD':/CNY|RMB|¥|￥|人民币|元/i.test(own)?'CNY':/USD|美元/i.test(context)?'USD':/CNY|RMB|人民币/i.test(context)?'CNY':'';
        if(currency&&/余额|balance|available credit|剩余金额/i.test(context)&&!used.test(own))mapping={...common,label:'账户余额',period:'balance',unit:currency,kind:'remaining',extract:'number'};
        else if(isRemaining&&!isUsed&&unit&&period!=='other')mapping={...common,unit,kind:'remaining',extract:'number'};
      }
    }
    if(!mapping)continue;
    if(mapping.extract==='number'){
      const magnitude=own.match(/\d[\d,.]*\s*(million|billion|thousand|万|亿|千|[kmb])(?:\b|(?=次|点|元|令牌))/i)?.[1].toLowerCase();
      if(magnitude)mapping.scale=({k:1000,m:1000000,b:1000000000,thousand:1000,million:1000000,billion:1000000000,'万':10000,'亿':100000000,'千':1000} as Record<string,number>)[magnitude];
    }
    // Prefer the innermost text node; prevent parent/child copies of the same quota.
    const signature=`${mapping.period}|${mapping.kind}|${own}|${context.replace(/\s+/g,' ').trim()}`;
    if(seen.has(signature)||draft.mappings.some(m=>m.valuePath===field.selector))continue;
    seen.add(signature);
    const model=context.match(/\b(?:Opus|Sonnet|Haiku|GPT[-\w.]*|Gemini[-\w.]*)\b/i)?.[0];
    if(model)mapping.label=`${model} ${mapping.label}`;
    draft.mappings.push(mapping);values.set(field.selector,own);evidence.push(context.slice(0,260));
  }
  if(!draft.mappings.length)throw new AppError('capture','没有识别到含义明确的额度。请先登录并打开用量/余额页，确保页面写明“已用”或“剩余”，再抓取；也可以返回复制 Agent 提示词协助接入。');
  if(!draft.account)warnings.push('页面没有可见账号标识，请填写一个方便辨认的名称。');
  if(!draft.plan)warnings.push('页面未识别到套餐名称，可以手动补充。');
  warnings.push('请对照当前页面核对结果；页面布局变化后可重新抓取。');
  const snapshot=mappedSnapshot(draft,p=>values.get(p),'web');
  return {id,draft,snapshot,evidence,warnings};
}

/** Serialized and run in an isolated world of the user-opened page. No imported bindings. */
export function collectVisiblePage(): PageScan {
  const fields: PageField[]=[];
  const excluded='input,textarea,script,style,noscript,svg,canvas,iframe,[hidden],[aria-hidden="true"],[contenteditable="true"]';
  const visible=(el:Element)=>{const rect=el.getBoundingClientRect(),s=getComputedStyle(el);return rect.width>0&&rect.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&!el.closest(excluded);};
  const selector=(el:Element):string=>{
    if(el.id&&el.id.length<100&&document.querySelectorAll('#'+CSS.escape(el.id)).length===1)return '#'+CSS.escape(el.id);
    for(const attr of ['data-testid','data-test','data-qa']){const val=el.getAttribute(attr);if(val&&val.length<100){const s=`[${attr}=${JSON.stringify(val)}]`;if(document.querySelectorAll(s).length===1)return s;}}
    const parts:string[]=[];let current:Element|null=el;
    while(current&&current!==document.documentElement&&parts.length<18){const parent:Element|null=current.parentElement;const tag=current.tagName.toLowerCase();const siblings=parent?[...parent.children].filter(e=>e.tagName===current!.tagName):[];parts.unshift(tag+(siblings.length>1?`:nth-of-type(${siblings.indexOf(current)+1})`:''));current=parent;}
    return 'html > '+parts.join(' > ');
  };
  const context=(el:HTMLElement,text:string)=>{
    let current:HTMLElement|null=el.parentElement,best=text;
    for(let depth=0;depth<4&&current&&current!==document.body;depth++,current=current.parentElement){
      const t=current.innerText?.replace(/\s+/g,' ').trim()??'';
      if(t.length>700)break;
      if(t.length>best.length)best=t;
      if(/5\s*(小时|hours?|h\b)|周|月|日额度|weekly|monthly|daily|session|余额|balance|套餐|current plan|your plan/i.test(t))break;
    }
    return best;
  };
  const nodes=document.body?document.body.querySelectorAll('*'):[];
  for(let i=0;i<Math.min(nodes.length,16000)&&fields.length<2500;i++){
    const el=nodes[i];if(!(el instanceof HTMLElement)||!visible(el)||el.children.length>3)continue;
    const text=el.innerText?.replace(/\s+/g,' ').trim()??'';
    if(!text||text.length>160)continue;
    if([...el.children].some(c=>c instanceof HTMLElement&&/\d/.test(c.innerText??'')))continue;
    if([...el.children].some(c=>c instanceof HTMLElement&&c.innerText?.replace(/\s+/g,' ').trim()===text))continue;
    const path=selector(el);if(path.length>480)continue;
    fields.push({text,selector:path,context:context(el,text),tag:el.tagName.toLowerCase()});
  }
  return {url:location.href,title:document.title.slice(0,200),fields};
}
