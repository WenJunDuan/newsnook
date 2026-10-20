import {useEffect,useRef,useState} from 'react'
import {agentApprovalReason,browserAgentAction,decideAgentStep,loadAgentConfig,saveAgentConfig,type AgentConfig,type AgentObservation,type AgentTab,type AgentScreenshot} from './browserAgent'

export function BrowserAgentPanel({tabId,loading,progress,tabs,onNavigate,onBack,onForward,onNewTab,onSwitchTab,onCloseTab,onClose}: {
  tabId?:number;loading?:boolean;progress?:number;tabs:AgentTab[];onNavigate:(url:string)=>Promise<boolean>;onBack:()=>Promise<boolean>;onForward:()=>Promise<boolean>;onNewTab:(url:string)=>Promise<boolean>;onSwitchTab:(index:number)=>Promise<boolean>;onCloseTab:(index:number)=>Promise<boolean>;onClose:()=>void
}){
  const [config,setConfig]=useState<AgentConfig>({endpoint:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1'})
  const [goal,setGoal]=useState('')
  const [busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false)
  const [configReady,setConfigReady]=useState(false)
  const [status,setStatus]=useState('')
  const [answer,setAnswer]=useState('')
  const [approval,setApproval]=useState<string|null>(null)
  const approvalResolve=useRef<((accepted:boolean)=>void)|null>(null)
  const controller=useRef<AbortController|null>(null)
  const latestTab=useRef(tabId)
  const latestLoading=useRef(loading)
  const latestProgress=useRef(progress)
  const latestTabs=useRef(tabs)
  latestTab.current=tabId;latestLoading.current=loading;latestProgress.current=progress;latestTabs.current=tabs
  useEffect(()=>{
    let live=true
    void loadAgentConfig().then(value=>{if(live)setConfig(value)})
      .catch(error=>{if(live)setStatus(String(error))})
      .finally(()=>{if(live)setConfigReady(true)})
    return ()=>{live=false}
  },[])
  useEffect(()=>()=>controller.current?.abort(),[])
  const stop=()=>{controller.current?.abort();approvalResolve.current?.(false);controller.current=null;setBusy(false);setStatus('已停止')}
  const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(new Error('已停止'));return}
    const t=window.setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms)
    const abort=()=>{window.clearTimeout(t);reject(new Error('已停止'))}
    signal.addEventListener('abort',abort,{once:true})
  })
  const wait=async(signal:AbortSignal)=>{
    for(let i=0;i<35;i++){
      if(signal.aborted)throw new Error('已停止')
      if(latestTab.current!=null&&!latestLoading.current && (latestProgress.current??0)>=100){
        await sleep(450,signal)
        if(!latestLoading.current && (latestProgress.current??0)>=100)return
      }
      await sleep(350,signal)
    }
    throw new Error('网页加载超时')
  }
  const requireApproval=(reason:string,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(new Error('已停止'));return}
    const cancel=()=>finish(false)
    const finish=(accepted:boolean)=>{
      signal.removeEventListener('abort',cancel)
      approvalResolve.current=null
      setApproval(null)
      if(accepted && !signal.aborted)resolve()
      else reject(new Error('本次操作已拒绝'))
    }
    approvalResolve.current=finish
    signal.addEventListener('abort',cancel,{once:true})
    setApproval(reason)
  })
  const run=async()=>{
    if(controller.current)return
    if(!goal.trim()){setStatus('请输入任务');return}
    const abort=new AbortController();controller.current=abort;setBusy(true);setStatus('正在读取配置');setAnswer('')
    const history:string[]=[]
    try{
      const runtimeConfig=await loadAgentConfig()
      if(abort.signal.aborted)throw new Error('已停止')
      if(!runtimeConfig.apiKey||!runtimeConfig.endpoint||!runtimeConfig.model){
        setEditing(true)
        throw new Error('请先配置并保存 API')
      }
      if(latestTab.current==null)throw new Error('请先打开网页')
      for(let step=0;step<35;step++){
        await wait(abort.signal)
        const id=latestTab.current
        if(id==null)throw new Error('浏览器已关闭')
        const observation=await browserAgentAction({action:'observe',tabId:id}) as unknown as AgentObservation
        if(abort.signal.aborted)throw new Error('已停止')
        setStatus(`第 ${step+1} 步 · AI 分析 ${observation.title||observation.url}`)
        const screenshot=history.at(-1)?.includes('\"action\":\"inspect\"')
          ? await browserAgentAction({action:'screenshot',tabId:id}) as unknown as AgentScreenshot : null
        const next=await decideAgentStep(runtimeConfig,goal,observation,history,abort.signal,screenshot??undefined,latestTabs.current)
        if(abort.signal.aborted)throw new Error('已停止')
        history.push(JSON.stringify({url:observation.url,action:next}))
        if(next.action==='finish'){setAnswer(next.answer||'任务完成');setStatus('已完成');return}
        if(next.action==='inspect')continue
        setStatus(`第 ${step+1} 步 · ${next.reason||next.action}`)
        const approvalReason=agentApprovalReason(next,observation)
        if(approvalReason)await requireApproval(approvalReason,abort.signal)
        if(next.action==='tap'){
          if(!screenshot)throw new Error('截图已经失效，需要重新检查页面')
          const actual=await browserAgentAction({action:'screenshot',tabId:id})
          if(Number(actual.viewWidth)!==screenshot.viewWidth || Number(actual.viewHeight)!==screenshot.viewHeight)
            throw new Error('网页尺寸已变化，请重新发起截图操作')
          const x=Math.round(Number(next.x)*screenshot.viewWidth/screenshot.width)
          const y=Math.round(Number(next.y)*screenshot.viewHeight/screenshot.height)
          await browserAgentAction({action:'tap',tabId:id,x,y,snapshot:observation.snapshot})
        }else if(next.action==='navigate'){
          if(!(await onNavigate(next.url!)))throw new Error('网页导航失败')
        }else if(next.action==='back'){
          if(!(await onBack()))throw new Error('网页返回失败')
        }else if(next.action==='forward'){
          if(!(await onForward()))throw new Error('网页前进失败')
        }else if(next.action==='new_tab'){
          if(!(await onNewTab(next.url!)))throw new Error('新建标签页失败')
        }else if(next.action==='switch_tab'){
          if(!(await onSwitchTab(next.index!)))throw new Error('切换标签页失败')
        }else if(next.action==='close_tab'){
          if(!(await onCloseTab(next.index!)))throw new Error('关闭标签页失败')
        }else{
          await browserAgentAction({action:next.action,tabId:id,id:next.id,text:next.text,direction:next.direction,snapshot:observation.snapshot})
        }
        await sleep(next.action==='type'?400:1000,abort.signal)
      }
      throw new Error('已达到 35 步操作上限，请缩小任务范围')
    }catch(error){if(!abort.signal.aborted)setStatus(error instanceof Error?error.message:'任务失败')}
    finally{if(controller.current===abort){controller.current=null;setBusy(false)}}
  }
  const save=async()=>{try{await saveAgentConfig(config);setEditing(false);setStatus('配置已保存')}catch(error){setStatus(error instanceof Error?error.message:'保存失败')}}
  return <section aria-label="AI 浏览助手" className="relative shrink-0 border-t border-haze bg-ink-raised p-3 text-paper" style={{maxHeight:'min(56dvh, 450px)',overflowY:'auto'}}>
    <div className="mb-2 flex items-center justify-between"><strong className="text-[15px]">AI 浏览助手</strong><div className="flex gap-3 text-[13px]"><button type="button" onClick={()=>setEditing(!editing)} disabled={busy||!configReady}>API 设置</button><button type="button" onClick={()=>{stop();onClose()}}>关闭</button></div></div>
    {editing&&<div className="mb-3 grid gap-2 text-[13px]">
      <label>Base URL<input aria-label="Agent Base URL" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.endpoint} onChange={e=>setConfig({...config,endpoint:e.target.value})}/></label>
      <label>Model<input aria-label="Agent Model" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.model} onChange={e=>setConfig({...config,model:e.target.value})}/></label>
      <label>API Key<input aria-label="Agent API Key" type="password" autoComplete="off" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.apiKey} onChange={e=>setConfig({...config,apiKey:e.target.value})}/></label>
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="允许局域网 HTTP" checked={config.allowLanHttp===true}
        onChange={e=>setConfig({...config,allowLanHttp:e.target.checked})}/>允许局域网 HTTP（API Key 明文传输）</label>
      <button type="button" onClick={()=>{void save()}} className="rounded-lg bg-paper px-3 py-2 font-medium text-ink">保存配置</button>
    </div>}
    <textarea aria-label="AI 浏览任务" rows={2} disabled={busy} value={goal} onChange={e=>setGoal(e.target.value)} placeholder="告诉 AI 在当前浏览器中完成什么任务…" className="w-full resize-none rounded-lg border border-haze bg-ink p-2 text-[14px]"/>
    {approval&&<div role="alertdialog" aria-label="确认 AI 网页操作" className="absolute inset-x-3 bottom-3 z-20 rounded-lg border border-haze bg-ink p-3 text-[13px] shadow-xl">
      <p className="mb-2">{approval}</p>
      <div className="flex gap-2"><button type="button" onClick={()=>approvalResolve.current?.(true)} className="rounded-md bg-paper px-3 py-2 font-medium text-ink">允许这一步</button>
      <button type="button" onClick={()=>approvalResolve.current?.(false)} className="rounded-md border border-haze px-3 py-2">拒绝</button></div>
    </div>}
    <div className="mt-2 flex items-center gap-3"><button type="button" disabled={busy||!configReady} onClick={()=>{void run()}} className="rounded-lg bg-paper px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-50">开始任务</button><button type="button" disabled={!busy} onClick={stop} className="rounded-lg border border-haze px-4 py-2 text-[13px] disabled:opacity-50">停止</button><span role="status" className="min-w-0 flex-1 text-[12px] text-paper-muted">{status}</span></div>
    {answer&&<div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-ink p-3 text-[13px] leading-relaxed">{answer}</div>}
  </section>
}
