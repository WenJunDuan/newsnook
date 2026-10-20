import {useEffect,useRef,useState} from 'react'
import {
  agentApprovalReason,browserAgentAction,browserAgentState,loadAgentConfig,runReActAgent,saveAgentConfig,
  type AgentConfig,type AgentObservation,type AgentScreenshot,type AgentTab,type AgentToolArguments,type AgentToolName,
  type AgentToolResult,type ReActRuntime,
} from './browserAgent'

interface Props {
  tabId?:number
  loading?:boolean
  progress?:number
  tabs:AgentTab[]
  onSearch:(query:string)=>Promise<boolean>
  onNavigate:(url:string)=>Promise<boolean>
  onBack:()=>Promise<boolean>
  onForward:()=>Promise<boolean>
  onNewTab:(url:string)=>Promise<boolean>
  onSwitchTab:(index:number)=>Promise<boolean>
  onCloseTab:(index:number)=>Promise<boolean>
  onClose:()=>void
}

const LABELS:Partial<Record<AgentToolName,string>>={
  browser_search:'正在搜索网页',browser_open_url:'正在打开网址',browser_observe:'正在阅读网页',
  browser_click:'正在点击网页',browser_type:'正在输入文字',browser_choose:'正在选择选项',
  browser_submit:'正在提交表单',browser_scroll:'正在滚动阅读',browser_back:'正在返回',
  browser_forward:'正在前进',browser_tabs:'正在查看标签页',browser_new_tab:'正在打开新标签',
  browser_switch_tab:'正在切换标签页',browser_close_tab:'正在关闭标签页',
  browser_screenshot:'正在观察网页画面',browser_tap:'正在操作网页画面',
}
function abortError(){return new DOMException('任务已停止','AbortError')}
function httpUrl(value:unknown):string {
  if(typeof value!=='string')throw new Error('请提供完整的网址')
  const parsed=new URL(value)
  if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password)
    throw new Error('只能打开有效的 HTTP/HTTPS 网页')
  return parsed.href
}
function elementId(args:AgentToolArguments):number {
  const id=args.id
  if(!Number.isInteger(id)||typeof id!=='number'||id<0||id>=90)throw new Error('无效的页面元素编号，请重新观察')
  return id
}
function textArg(value:unknown):string {
  if(typeof value!=='string'||!value.trim())throw new Error('请输入有效的内容')
  return value.trim()
}

export function BrowserAgentPanel({tabId,tabs,onSearch,onNavigate,onBack,onForward,onNewTab,onSwitchTab,onCloseTab,onClose}:Props){
  const [config,setConfig]=useState<AgentConfig>({endpoint:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1'})
  const [goal,setGoal]=useState('')
  const [busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false)
  const [configReady,setConfigReady]=useState(false)
  const [status,setStatus]=useState('')
  const [answer,setAnswer]=useState('')
  const [activity,setActivity]=useState<string[]>([])
  const [approval,setApproval]=useState<string|null>(null)
  const approvalResolve=useRef<((approved:boolean)=>void)|null>(null)
  const controller=useRef<AbortController|null>(null)
  const latestTabs=useRef(tabs)
  latestTabs.current=tabs

  useEffect(()=>{
    let mounted=true
    void loadAgentConfig().then(value=>{if(mounted)setConfig(value)})
      .catch(error=>{if(mounted)setStatus(String(error))})
      .finally(()=>{if(mounted)setConfigReady(true)})
    return ()=>{mounted=false}
  },[])
  useEffect(()=>()=>{controller.current?.abort();approvalResolve.current?.(false)},[])

  const stop=()=>{
    controller.current?.abort()
    approvalResolve.current?.(false)
    controller.current=null
    setBusy(false)
    setStatus('已停止')
  }
  const pauseForConfirmation=(reason:string,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(abortError());return}
    const done=(approved:boolean)=>{
      signal.removeEventListener('abort',onAbort)
      approvalResolve.current=null
      setApproval(null)
      if(approved&&!signal.aborted)resolve()
      else reject(new Error('用户拒绝了该操作'))
    }
    const onAbort=()=>done(false)
    approvalResolve.current=done
    signal.addEventListener('abort',onAbort,{once:true})
    setApproval(reason)
  })
  const sleep=(time:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(abortError());return}
    const onAbort=()=>{clearTimeout(timer);reject(abortError())}
    const timer=window.setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve()},time)
    signal.addEventListener('abort',onAbort,{once:true})
  })

  const run=async()=>{
    if(controller.current)return
    if(!goal.trim()){setStatus('请输入你想完成的任务');return}
    const abort=new AbortController()
    controller.current=abort
    setBusy(true);setAnswer('');setActivity([]);setStatus('AI 正在准备…')
    try{
      const runtimeConfig=await loadAgentConfig()
      if(abort.signal.aborted)throw abortError()
      if(!runtimeConfig.apiKey||!runtimeConfig.model||!runtimeConfig.endpoint){
        setEditing(true)
        throw new Error('请先保存 API 地址、模型和密钥')
      }
      let lastPage:AgentObservation|null=null
      let lastShot:AgentScreenshot|null=null
      let shotPage:string|null=null
      const observe=async(waitForPage=false):Promise<{page:AgentObservation|null;tabs:AgentTab[];status?:string}>=>{
        for(let attempt=0;attempt<72;attempt++){
          if(abort.signal.aborted)throw abortError()
          const snapshot=await browserAgentState()
          if(!snapshot.state.tabId){
            if(!waitForPage)return {page:null,tabs:snapshot.tabs,status:'尚未打开网页，可直接搜索或打开网址'}
          }else if(snapshot.state.error){
            if(!waitForPage)throw new Error(snapshot.state.error)
          }else if(!snapshot.state.loading && (snapshot.state.progress??0)>=100){
            try{
              const page=await browserAgentAction({action:'observe',tabId:snapshot.state.tabId}) as unknown as AgentObservation
              if(abort.signal.aborted)throw abortError()
              lastPage=page;lastShot=null;shotPage=null
              return {page,tabs:snapshot.tabs}
            }catch(error){if(attempt>=71)throw error}
          }
          await sleep(350,abort.signal)
        }
        throw new Error('网页加载超时，请检查网络连接或网站是否可访问')
      }
      const freshPage=async():Promise<unknown>=>observe(true)
      const executeElement=async(name:'click'|'type'|'choose'|'submit'|'scroll',args:AgentToolArguments):Promise<unknown>=>{
        if(!lastPage){await observe(true)}
        const page=lastPage!
        const id=name==='scroll'?undefined:elementId(args)
        if(id!==undefined&&!page.elements.some(item=>item.id===id))throw new Error('元素不存在，请重新观察网页')
        if(name==='click'||name==='submit'){
          const reason=agentApprovalReason({action:name,id},page)
          if(reason)await pauseForConfirmation(reason,abort.signal)
        }
        const text=name==='type'||name==='choose'?textArg(args.text):undefined
        const direction=name==='scroll'?(args.direction==='up'?'up':'down'):undefined
        if(abort.signal.aborted)throw abortError()
        const state=await browserAgentState()
        if(!state.state.tabId)throw new Error('浏览器已关闭')
        const result=await browserAgentAction({action:name,tabId:state.state.tabId,id,text,direction,snapshot:page.snapshot})
        if(abort.signal.aborted)throw abortError()
        await sleep(name==='type'?220:400,abort.signal)
        return {operation:result,observation:await freshPage()}
      }
      const runtime:ReActRuntime={
        onActivity:message=>{
          const name=Object.entries(LABELS).find(([,label])=>label===message)?.[1]||message
          setStatus(name)
        },
        performTool:async(name,args,signal):Promise<AgentToolResult>=>{
          if(signal.aborted)throw abortError()
          setStatus(LABELS[name]||'AI 正在操作网页')
          setActivity(previous=>[...previous.slice(-4),LABELS[name]||name])
          const finish=(result:unknown,screenshot?:AgentScreenshot):AgentToolResult=>({result,screenshot})
          switch(name){
            case 'browser_search':{
              const query=textArg(args.query)
              if(!await onSearch(query))throw new Error('搜索页面打开失败')
              lastPage=null;lastShot=null
              return finish({query,observation:await freshPage()})
            }
            case 'browser_open_url':{
              const url=httpUrl(args.url)
              if(!await onNavigate(url))throw new Error('网页打开失败')
              lastPage=null;lastShot=null
              return finish({url,observation:await freshPage()})
            }
            case 'browser_observe': return finish(await observe())
            case 'browser_click':return finish(await executeElement('click',args))
            case 'browser_type':return finish(await executeElement('type',args))
            case 'browser_choose':return finish(await executeElement('choose',args))
            case 'browser_submit':return finish(await executeElement('submit',args))
            case 'browser_scroll':return finish(await executeElement('scroll',args))
            case 'browser_back':
              if(!await onBack())throw new Error('无法返回')
              lastPage=null;lastShot=null
              return finish(await freshPage())
            case 'browser_forward':
              if(!await onForward())throw new Error('无法前进')
              lastPage=null;lastShot=null
              return finish(await freshPage())
            case 'browser_tabs':{
              const snapshot=await browserAgentState()
              return finish(snapshot)
            }
            case 'browser_new_tab':{
              const url=httpUrl(args.url)
              if(!await onNewTab(url))throw new Error('无法创建标签页')
              lastPage=null;lastShot=null
              return finish(await freshPage())
            }
            case 'browser_switch_tab':{
              if(!Number.isInteger(args.index))throw new Error('无效标签页序号')
              if(!await onSwitchTab(args.index as number))throw new Error('无法切换标签页')
              lastPage=null;lastShot=null
              return finish(await freshPage())
            }
            case 'browser_close_tab':{
              if(!Number.isInteger(args.index))throw new Error('无效标签页序号')
              const reason=agentApprovalReason({action:'close_tab',index:args.index as number},lastPage||{url:'',title:'',snapshot:'',text:'',elements:[],viewport:{width:0,height:0}})
              if(reason)await pauseForConfirmation(reason,signal)
              if(!await onCloseTab(args.index as number))throw new Error('无法关闭标签页')
              lastPage=null;lastShot=null
              return finish(await observe())
            }
            case 'browser_screenshot':{
              if(!lastPage)await observe(true)
              const state=await browserAgentState()
              if(!state.state.tabId)throw new Error('当前没有可截图的网页')
              const shot=await browserAgentAction({action:'screenshot',tabId:state.state.tabId}) as unknown as AgentScreenshot
              if(!shot.image||!shot.width||!shot.height)throw new Error('浏览器截图无效')
              lastShot=shot;shotPage=lastPage?.snapshot||null
              return finish({width:shot.width,height:shot.height,page:lastPage?.url},shot)
            }
            case 'browser_tap':{
              if(!lastShot||!lastPage||shotPage!==lastPage.snapshot)throw new Error('请先获取当前页面截图')
              if(typeof args.x!=='number'||typeof args.y!=='number'||!Number.isInteger(args.x)||!Number.isInteger(args.y))throw new Error('坐标必须是截图像素')
              const x=Math.round(args.x*lastShot.viewWidth/lastShot.width)
              const y=Math.round(args.y*lastShot.viewHeight/lastShot.height)
              if(x<0||y<0||x>=lastShot.viewWidth||y>=lastShot.viewHeight)throw new Error('坐标超出截图范围')
              const cssX=args.x*lastPage.viewport.width/lastShot.width
              const cssY=args.y*lastPage.viewport.height/lastShot.height
              const closest=lastPage.elements.map(item=>({item,dist:Math.hypot(item.x-cssX,item.y-cssY)})).sort((a,b)=>a.dist-b.dist)[0]
              if(closest&&closest.dist<42){
                const reason=agentApprovalReason({action:'click',id:closest.item.id},lastPage)
                if(reason)await pauseForConfirmation(reason,signal)
              }else{
                await pauseForConfirmation('即将点击无法识别的网页区域，请确认',signal)
              }
              const state=await browserAgentState()
              if(!state.state.tabId)throw new Error('当前没有网页')
              const response=await browserAgentAction({action:'tap',tabId:state.state.tabId,x,y,snapshot:lastPage.snapshot})
              lastShot=null;shotPage=null
              await sleep(450,signal)
              return finish({operation:response,observation:await freshPage()})
            }
          }
        },
      }
      const initial=await browserAgentState()
      const result=await runReActAgent(runtimeConfig,goal.trim(),{...initial,uiTabId:tabId},runtime,abort.signal)
      if(abort.signal.aborted)throw abortError()
      setAnswer(result)
      setStatus('已完成')
    }catch(error){if(!abort.signal.aborted)setStatus(error instanceof Error?error.message:'浏览任务失败')}
    finally{if(controller.current===abort){controller.current=null;setBusy(false)}}
  }

  const save=async()=>{
    try{await saveAgentConfig(config);setEditing(false);setStatus('配置已保存')}
    catch(error){setStatus(error instanceof Error?error.message:'保存失败')}
  }

  return <section aria-label="AI 浏览助手" className="relative shrink-0 border-t border-haze bg-ink-raised p-3 text-paper" style={{maxHeight:'min(56dvh,450px)',overflowY:'auto'}}>
    <div className="mb-2 flex items-center justify-between"><strong className="text-[15px]">AI 浏览助手</strong><div className="flex gap-3 text-[13px]">
      <button type="button" onClick={()=>setEditing(!editing)} disabled={busy||!configReady}>API 设置</button>
      <button type="button" onClick={()=>{stop();onClose()}}>关闭</button>
    </div></div>
    {editing&&<div className="mb-3 grid gap-2 text-[13px]">
      <label>Base URL<input aria-label="Agent Base URL" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.endpoint} onChange={e=>setConfig({...config,endpoint:e.target.value})}/></label>
      <label>Model<input aria-label="Agent Model" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.model} onChange={e=>setConfig({...config,model:e.target.value})}/></label>
      <label>API Key<input aria-label="Agent API Key" type="password" autoComplete="off" className="mt-1 w-full rounded-lg border border-haze bg-ink p-2" value={config.apiKey} onChange={e=>setConfig({...config,apiKey:e.target.value})}/></label>
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="允许局域网 HTTP" checked={config.allowLanHttp===true} onChange={e=>setConfig({...config,allowLanHttp:e.target.checked})}/>允许局域网 HTTP（API Key 明文传输）</label>
      <button type="button" onClick={()=>{void save()}} className="rounded-lg bg-paper px-3 py-2 font-medium text-ink">保存配置</button>
    </div>}
    <textarea aria-label="AI 浏览任务" rows={2} disabled={busy} value={goal} onChange={e=>setGoal(e.target.value)} placeholder="一句话告诉 AI 想做什么，例如：搜索最新的 Qwen 模型评价…" className="w-full resize-none rounded-lg border border-haze bg-ink p-2 text-[14px]"/>
    {approval&&<div role="alertdialog" aria-label="确认 AI 网页操作" className="absolute inset-x-3 bottom-3 z-20 rounded-lg border border-haze bg-ink p-3 text-[13px] shadow-xl">
      <p className="mb-2">{approval}</p>
      <div className="flex gap-2"><button type="button" onClick={()=>approvalResolve.current?.(true)} className="rounded-md bg-paper px-3 py-2 font-medium text-ink">允许这一步</button>
        <button type="button" onClick={()=>approvalResolve.current?.(false)} className="rounded-md border border-haze px-3 py-2">拒绝</button></div>
    </div>}
    <div className="mt-2 flex items-center gap-3">
      <button type="button" disabled={busy||!configReady} onClick={()=>{void run()}} className="rounded-lg bg-paper px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-50">开始任务</button>
      <button type="button" disabled={!busy} onClick={stop} className="rounded-lg border border-haze px-4 py-2 text-[13px] disabled:opacity-50">停止</button>
      <span role="status" className="min-w-0 flex-1 text-[12px] text-paper-muted">{status}</span>
    </div>
    {busy&&activity.length>0&&<p className="mt-1 truncate text-[11px] text-paper-muted">{activity.slice(-3).join(' · ')}</p>}
    {answer&&<div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-ink p-3 text-[13px] leading-relaxed">{answer}</div>}
  </section>
}
