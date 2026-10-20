import {useEffect,useRef,useState} from 'react'
import {browserAgentAction,decideAgentStep,loadAgentConfig,saveAgentConfig,type AgentConfig,type AgentObservation} from './browserAgent'

export function BrowserAgentPanel({tabId,loading,onNavigate,onBack,onClose}: {
  tabId?:number;loading?:boolean;onNavigate:(url:string)=>Promise<boolean>;onBack:()=>Promise<boolean>;onClose:()=>void
}){
  const [config,setConfig]=useState<AgentConfig>({endpoint:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1'})
  const [goal,setGoal]=useState('')
  const [busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false)
  const [status,setStatus]=useState('')
  const [answer,setAnswer]=useState('')
  const controller=useRef<AbortController|null>(null)
  const latestTab=useRef(tabId)
  const latestLoading=useRef(loading)
  latestTab.current=tabId;latestLoading.current=loading
  useEffect(()=>{void loadAgentConfig().then(setConfig).catch(error=>setStatus(String(error)))},[])
  useEffect(()=>()=>controller.current?.abort(),[])
  const stop=()=>{controller.current?.abort();controller.current=null;setBusy(false);setStatus('已停止')}
  const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(new Error('已停止'));return}
    const t=window.setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms)
    const abort=()=>{window.clearTimeout(t);reject(new Error('已停止'))}
    signal.addEventListener('abort',abort,{once:true})
  })
  const wait=async(signal:AbortSignal)=>{
    for(let i=0;i<35;i++){
      if(signal.aborted)throw new Error('已停止')
      if(latestTab.current!=null&&!latestLoading.current){await sleep(450,signal);if(!latestLoading.current)return}
      await sleep(350,signal)
    }
    throw new Error('网页加载超时')
  }
  const run=async()=>{
    if(!goal.trim()){setStatus('请输入任务');return}
    if(!config.apiKey||!config.endpoint||!config.model){setEditing(true);setStatus('请先配置 API');return}
    if(tabId==null){setStatus('请先打开网页');return}
    const abort=new AbortController();controller.current=abort;setBusy(true);setStatus('正在观察网页');setAnswer('')
    const history:string[]=[]
    try{
      for(let step=0;step<35;step++){
        await wait(abort.signal)
        const id=latestTab.current
        if(id==null)throw new Error('浏览器已关闭')
        const observation=await browserAgentAction({action:'observe',tabId:id}) as unknown as AgentObservation
        if(abort.signal.aborted)throw new Error('已停止')
        setStatus(`第 ${step+1} 步 · AI 分析 ${observation.title||observation.url}`)
        const screenshot=history.at(-1)?.includes('\"action\":\"inspect\"') ? await browserAgentAction({action:'screenshot',tabId:id}) : null
        const next=await decideAgentStep(config,goal,observation,history,abort.signal,typeof screenshot?.image==='string'?screenshot.image:undefined)
        if(abort.signal.aborted)throw new Error('已停止')
        history.push(JSON.stringify({url:observation.url,action:next}))
        if(next.action==='finish'){setAnswer(next.answer||'任务完成');setStatus('已完成');return}
        if(next.action==='inspect')continue
        setStatus(`第 ${step+1} 步 · ${next.reason||next.action}`)
        if(next.action==='tap'){
          if(!screenshot)throw new Error('截图已经失效，需要重新检查页面')
          const actual=await browserAgentAction({action:'screenshot',tabId:id})
          const imageWidth=Number(actual.width),imageHeight=Number(actual.height)
          const x=Math.round(Number(next.x)*Number(actual.viewWidth)/imageWidth)
          const y=Math.round(Number(next.y)*Number(actual.viewHeight)/imageHeight)
          await browserAgentAction({action:'tap',tabId:id,x,y})
        }else if(next.action==='navigate'){
          if(!(await onNavigate(next.url!)))throw new Error('网页导航失败')
        }else if(next.action==='back'){
          if(!(await onBack()))throw new Error('网页返回失败')
        }else{
          await browserAgentAction({action:next.action,tabId:id,id:next.id,text:next.text,direction:next.direction})
        }
        await sleep(next.action==='type'?400:1000,abort.signal)
      }
      throw new Error('已达到 35 步操作上限，请缩小任务范围')
    }catch(error){if(!abort.signal.aborted)setStatus(error instanceof Error?error.message:'任务失败')}
    finally{if(controller.current===abort){controller.current=null;setBusy(false)}}
  }
  const save=async()=>{try{await saveAgentConfig(config);setEditing(false);setStatus('配置已保存')}catch(error){setStatus(error instanceof Error?error.message:'保存失败')}}
  return <section aria-label="AI 浏览助手" className="shrink-0 border-t border-haze bg-ink-raised p-3 text-paper" style={{maxHeight:'min(56dvh, 450px)',overflowY:'auto'}}>
    <div className="mb-2 flex items-center justify-between"><strong className="text-[15px]">AI 浏览助手</strong><div className="flex gap-3 text-[13px]"><button type="button" onClick={()=>setEditing(!editing)} disabled={busy}>API 设置</button><button type="button" onClick={()=>{stop();onClose()}}>关闭</button></div></div>
    {editing&&<div className="mb-3 grid gap-2 text-[13px]">
      <label>Base URL<input aria-label="Agent Base URL" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.endpoint} onChange={e=>setConfig({...config,endpoint:e.target.value})}/></label>
      <label>Model<input aria-label="Agent Model" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.model} onChange={e=>setConfig({...config,model:e.target.value})}/></label>
      <label>API Key<input aria-label="Agent API Key" type="password" autoComplete="off" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.apiKey} onChange={e=>setConfig({...config,apiKey:e.target.value})}/></label>
      <button type="button" onClick={()=>{void save()}} className="rounded-lg bg-paper px-3 py-2 font-medium text-ink">保存配置</button>
    </div>}
    <textarea aria-label="AI 浏览任务" rows={2} disabled={busy} value={goal} onChange={e=>setGoal(e.target.value)} placeholder="告诉 AI 在当前浏览器中完成什么任务…" className="w-full resize-none rounded-lg border border-haze bg-ink p-2 text-[14px]"/>
    <div className="mt-2 flex items-center gap-3"><button type="button" disabled={busy} onClick={()=>{void run()}} className="rounded-lg bg-paper px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-50">开始任务</button><button type="button" disabled={!busy} onClick={stop} className="rounded-lg border border-haze px-4 py-2 text-[13px] disabled:opacity-50">停止</button><span role="status" className="min-w-0 flex-1 text-[12px] text-paper-muted">{status}</span></div>
    {answer&&<div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-ink p-3 text-[13px] leading-relaxed">{answer}</div>}
  </section>
}
