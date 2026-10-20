import {useEffect,useRef,useState,type RefObject,type KeyboardEvent} from 'react'
import {
  AlertCircle, ArrowUp, Bot, Check, CheckCheck, ChevronDown, CircleCheck, Copy,
  Eye, EyeOff, LoaderCircle, Maximize2, Minimize2, Settings2, Square, X,
} from 'lucide-react'
import {AgentMarkdown} from './AgentMarkdown'
import {useAgentSheet} from './agentSheet'
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
  sheetRef:RefObject<HTMLElement|null>
  minimized:boolean
  onMinimize:()=>void
  onNeedAttention:()=>void
  onBusyChange:(busy:boolean)=>void
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

export function BrowserAgentPanel({tabId,tabs,sheetRef,minimized,onMinimize,onNeedAttention,onBusyChange,onSearch,onNavigate,onBack,onForward,onNewTab,onSwitchTab,onCloseTab,onClose}:Props){
  const [config,setConfig]=useState<AgentConfig>({endpoint:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1'})
  const [goal,setGoal]=useState('')
  const [busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false)
  const [configReady,setConfigReady]=useState(false)
  const [status,setStatus]=useState('')
  const [turns,setTurns]=useState<{goal:string;answer:string}[]>([])
  const [activeGoal,setActiveGoal]=useState('')
  const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const [showKey,setShowKey]=useState(false)
  const [copied,setCopied]=useState<number|null>(null)
  const [closePrompt,setClosePrompt]=useState(false)
  const scrollRef=useRef<HTMLDivElement>(null)
  const lastTurnCount=useRef(0)
  const lastActiveGoal=useRef('')
  const {height,dragging,isFull,expand,onPointerDown,onPointerMove,onPointerEnd,snapTo,limits}=useAgentSheet(sheetRef)
  const [activity,setActivity]=useState<string[]>([])
  const [approval,setApproval]=useState<string|null>(null)
  const approvalResolve=useRef<((approved:boolean)=>void)|null>(null)
  const controller=useRef<AbortController|null>(null)

  useEffect(()=>{
    let mounted=true
    void loadAgentConfig().then(value=>{if(mounted)setConfig(value)})
      .catch(error=>{if(mounted)setStatus(String(error))})
      .finally(()=>{if(mounted)setConfigReady(true)})
    return ()=>{mounted=false}
  },[])
  useEffect(()=>()=>{controller.current?.abort();approvalResolve.current?.(false)},[])
  useEffect(()=>onBusyChange(busy),[busy,onBusyChange])
  useEffect(()=>{
    const transcript=scrollRef.current
    const newTurn=turns.length>lastTurnCount.current
    const newGoal=Boolean(activeGoal && lastActiveGoal.current!==activeGoal)
    lastTurnCount.current=turns.length
    lastActiveGoal.current=activeGoal
    if(!transcript||minimized)return
    if(newTurn){
      // Start at the beginning of the latest Markdown answer, not its ending.
      const entries=transcript.querySelectorAll<HTMLElement>('[data-agent-turn]')
      const target=entries[entries.length-1]
      if(target){
        const offset=target.getBoundingClientRect().top-transcript.getBoundingClientRect().top+transcript.scrollTop
        transcript.scrollTop=Math.max(0,offset-12)
      }
    }else if(newGoal||((busy||activeGoal)&&transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<145)){
      transcript.scrollTop=transcript.scrollHeight
    }
  },[turns,activeGoal,activity,status,minimized,busy])

  const stop=()=>{
    controller.current?.abort()
    approvalResolve.current?.(false)
    controller.current=null
    setBusy(false)
    setActiveGoal('')
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
    onNeedAttention()
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
    const request=goal.trim()
    const abort=new AbortController()
    controller.current=abort
    setBusy(true);setError('');setActiveGoal(request);setActivity([]);setStatus('正在准备…')
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
        onActivity:message=>setStatus(LABELS[message as AgentToolName]||message),
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
      const result=await runReActAgent(runtimeConfig,request,{...initial,uiTabId:tabId,
        previousTurns:turns.slice(-3).map(turn=>({goal:turn.goal,answer:turn.answer.slice(0,1600)}))},runtime,abort.signal)
      if(abort.signal.aborted)throw abortError()
      setTurns(previous=>[...previous.slice(-7),{goal:request,answer:result}])
      setGoal('')
      setActiveGoal('')
      setStatus('已完成')
    }catch(failure){
      if(!abort.signal.aborted){
        const message=failure instanceof Error?failure.message:'浏览任务失败'
        setError(message);setStatus(message);setActiveGoal('')
      }
    }finally{if(controller.current===abort){controller.current=null;setBusy(false)}}
  }

  const save=async()=>{
    if(saving)return
    setSaving(true);setError('')
    try{await saveAgentConfig(config);setEditing(false);setStatus('配置已保存')}
    catch(failure){const message=failure instanceof Error?failure.message:'保存失败';setError(message);setStatus(message)}
    finally{setSaving(false)}
  }
  const copyResult=async(index:number,markdown:string)=>{
    try{await navigator.clipboard.writeText(markdown);setCopied(index)}
    catch{setError('无法复制内容，请重试')}
  }
  const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){
      event.preventDefault()
      void run()
    }
  }
  const requestClose=()=>{
    if(busy){setClosePrompt(true);return}
    onClose()
  }

  return <section ref={sheetRef} aria-label="AI 浏览助手" role="region" hidden={minimized}
    data-agent-sheet data-dragging={dragging?'true':'false'} data-fullscreen={isFull?'true':'false'}
    className="agent-sheet" style={{height:height+'px',maxHeight:'calc(100dvh - var(--sat))'}}>
    <div role="separator" tabIndex={0} aria-label="拖动调整 AI 面板高度" aria-orientation="horizontal"
      aria-valuenow={Math.round(height)} aria-valuemin={limits().min} aria-valuemax={limits().max}
      className="agent-grip-area shrink-0" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onDoubleClick={expand}
      onKeyDown={event=>{
        if(event.key==='ArrowUp'||event.key==='ArrowDown'){
          event.preventDefault();snapTo(height+(event.key==='ArrowUp'?40:-40))
        }else if(event.key==='Home'){event.preventDefault();snapTo(limits().min)}
        else if(event.key==='End'){event.preventDefault();snapTo(limits().max)}
      }}>
      <span className="agent-grip"/>
    </div>
    <header className="flex min-h-[51px] shrink-0 items-center gap-2 border-b border-haze/70 px-4 pb-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[13px] bg-haze/70 text-paper"><Bot size={20} strokeWidth={1.75}/></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><h2 className="truncate text-[15px] font-semibold tracking-[-.015em]">AI 浏览助手</h2>
          {busy&&<LoaderCircle size={14} className="shrink-0 animate-spin text-cinnabar" aria-hidden="true"/>}</div>
        <p className="truncate text-[11.5px] leading-[1.4] text-paper-muted">{editing?'模型与连接设置':busy?'正在执行任务':tabs.length?tabs.find(tab=>tab.active)?.title||'浏览器': '随时开始浏览任务'}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" aria-label={editing?'返回任务':'API 设置'} aria-pressed={editing} disabled={busy&&!editing||!configReady}
          className="agent-icon-button" onClick={()=>{setError('');setEditing(value=>!value)}}><Settings2 size={19}/></button>
        <button type="button" aria-label={isFull?'恢复半屏':'展开全屏'} aria-pressed={isFull} className="agent-icon-button" onClick={expand}>
          {isFull?<Minimize2 size={19}/>:<Maximize2 size={19}/>}</button>
        <button type="button" aria-label="收起 AI 面板" className="agent-icon-button" onClick={onMinimize}><ChevronDown size={21}/></button>
        <button type="button" aria-label="关闭 AI 浏览助手" className="agent-icon-button" onClick={requestClose}><X size={20}/></button>
      </div>
    </header>
    {editing?<div className="agent-transcript px-5 py-5" data-agent-settings>
      <div className="mb-5"><h3 className="text-[18px] font-semibold">模型设置</h3><p className="mt-1 text-[13px] leading-relaxed text-paper-muted">连接支持工具调用的 OpenAI 兼容模型。</p></div>
      <form className="grid gap-4 text-[13px]" onSubmit={event=>{event.preventDefault();void save()}}>
        <label className="grid gap-1.5 font-medium">API 地址
          <input aria-label="Agent Base URL" spellCheck={false} autoCapitalize="off" autoCorrect="off" className="agent-field min-h-11 px-3 text-[14px] font-normal" value={config.endpoint} onChange={event=>setConfig(previous=>({...previous,endpoint:event.target.value}))} placeholder="https://api.openai.com/v1" />
        </label>
        <label className="grid gap-1.5 font-medium">模型
          <input aria-label="Agent Model" spellCheck={false} autoCapitalize="off" autoCorrect="off" className="agent-field min-h-11 px-3 text-[14px] font-normal" value={config.model} onChange={event=>setConfig(previous=>({...previous,model:event.target.value}))} placeholder="支持工具调用的模型名称"/>
        </label>
        <label className="grid gap-1.5 font-medium">API Key
          <div className="relative"><input aria-label="Agent API Key" type={showKey?'text':'password'} autoComplete="off" spellCheck={false} className="agent-field min-h-11 px-3 pr-11 text-[14px] font-normal" value={config.apiKey} onChange={event=>setConfig(previous=>({...previous,apiKey:event.target.value}))}/>
            <button type="button" aria-label={showKey?'隐藏 API Key':'显示 API Key'} className="absolute inset-y-0 right-1 flex w-10 items-center justify-center text-paper-muted" onClick={()=>setShowKey(value=>!value)}>{showKey?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>
        </label>
        <label className="flex min-h-10 items-center justify-between gap-3"><span className="min-w-0"><span className="block font-medium">允许局域网 HTTP</span><span className="block text-[12px] leading-relaxed text-paper-muted">仅用于本地模型，密钥将以明文传输</span></span>
          <input type="checkbox" aria-label="允许局域网 HTTP" checked={config.allowLanHttp===true} onChange={event=>setConfig(previous=>({...previous,allowLanHttp:event.target.checked}))} className="size-5 accent-cinnabar"/></label>
        {error&&<div role="alert" className="flex gap-2 text-[13px] leading-relaxed text-cinnabar"><AlertCircle size={17} className="mt-0.5 shrink-0"/>{error}</div>}
        <div className="mt-1 flex justify-end gap-2"><button type="button" className="agent-secondary" onClick={()=>{setEditing(false);setError('')}}>取消</button>
          <button type="submit" disabled={saving} className="agent-primary">{saving?<LoaderCircle size={16} className="animate-spin"/>:<Check size={16}/>}保存配置</button></div>
      </form>
    </div>:<>
      <div ref={scrollRef} className="agent-transcript" data-agent-transcript>
        {turns.length===0&&!activeGoal&&<div className="px-5 pb-6 pt-8">
          <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-haze/70 text-paper"><Bot size={26} strokeWidth={1.5}/></span>
          <h3 className="text-[21px] font-semibold tracking-[-.035em] leading-tight">一句话，交给 AI 浏览</h3>
          <p className="mt-2 max-w-[320px] text-[14px] leading-[1.7] text-paper-muted">自动搜索、浏览与整理结果，也可以操作当前网页。</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {(tabId?[ '总结当前网页', '查找相关资料' ]:[ '搜索今日科技资讯', '查找某个网站' ]).map(suggestion=><button type="button" key={suggestion} onClick={()=>setGoal(suggestion)} className="rounded-full border border-haze px-3.5 py-2 text-[13px] text-paper-muted transition-colors active:bg-haze">{suggestion}</button>)}
          </div>
        </div>}
        {turns.map((turn,index)=><div key={index} data-agent-turn className="px-5 pt-5">
          <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-haze/70 px-3.5 py-3 text-[14px] leading-relaxed text-paper">{turn.goal}</div>
          <div className="mt-5 pb-2">
            <div className="mb-3 flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-[12px] font-semibold text-paper-muted"><Bot size={15}/>浏览结果</span>
              <button type="button" aria-label="复制 AI 回答" className="agent-icon-button !size-8" onClick={()=>{void copyResult(index,turn.answer)}}>
                {copied===index?<CheckCheck size={16}/>:<Copy size={16}/>}</button></div>
            <AgentMarkdown markdown={turn.answer} onNavigate={onNavigate}/>
          </div>
          {index<turns.length-1&&<div className="mt-4 border-t border-haze"/>}
        </div>)}
        {activeGoal&&<div className="px-5 pb-4 pt-5">
          <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-haze/70 px-3.5 py-3 text-[14px] leading-relaxed text-paper">{activeGoal}</div>
        </div>}
        {busy&&<div className="px-5 pb-5 pt-1" data-agent-running>
          <div className="flex items-center gap-2.5 text-[13px] font-medium"><LoaderCircle size={16} className="shrink-0 animate-spin text-cinnabar"/><span role="status" className="min-w-0 truncate">{status}</span></div>
          {activity.length>0&&<div className="ml-[7px] mt-3 grid gap-2 border-l border-haze pl-[19px]">
            {activity.slice(-3).map((item,index)=><p key={index} className="flex items-center gap-2 text-[12px] text-paper-muted"><CircleCheck size={13} className="shrink-0"/>{item.replace(/^正在/,'已')}</p>)}
          </div>}
        </div>}
        {!busy&&error&&<div role="alert" className="mx-5 my-4 flex items-start gap-2 rounded-xl border border-haze p-3 text-[13px] leading-relaxed text-cinnabar"><AlertCircle size={17} className="shrink-0"/>{error}</div>}
      </div>
      <div className="agent-composer px-4 pb-3 pt-3" data-agent-composer>
        <div className="flex items-end gap-2 rounded-[17px] border border-haze bg-ink p-1.5 pl-3">
          <textarea aria-label="AI 浏览任务" rows={2} disabled={busy} value={goal} onChange={event=>setGoal(event.target.value)} onKeyDown={keyDown}
            placeholder="告诉 AI 你想搜索、阅读或操作什么…" className="min-h-[44px] max-h-[120px] min-w-0 flex-1 resize-none bg-transparent px-0 py-2 text-[14px] leading-[1.55] text-paper outline-none placeholder:text-paper-faint disabled:opacity-50"/>
          <button type="button" disabled={!configReady||(!busy&&!goal.trim())} onClick={()=>{if(busy)stop();else void run()}}
            aria-label={busy?'停止':'开始任务'} className="agent-primary !size-10 !min-h-10 !shrink-0 !rounded-[12px] !p-0" title={busy?'停止':'开始任务'}>
            {busy?<Square size={16} fill="currentColor"/>:<ArrowUp size={20} strokeWidth={2.5}/>}</button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11.5px] leading-5 text-paper-muted">
          <span role="status" className="min-w-0 flex-1 truncate">{!busy?status||'就绪':'AI 正在自主操作浏览器'}</span>
          {busy&&<button type="button" onClick={stop} className="shrink-0 text-paper underline underline-offset-4">停止</button>}
        </div>
      </div>
    </>}
    {(approval||closePrompt)&&<div className="absolute inset-0 z-30 flex items-end justify-center bg-ink/70 px-4 pb-[calc(var(--sab)+18px)]" role="presentation">
      <div role="alertdialog" aria-label={approval?'确认 AI 网页操作':'停止并关闭 AI'} className="w-full max-w-md rounded-[19px] border border-haze bg-ink-raised p-5 shadow-xl">
        <h3 className="text-[16px] font-semibold">{approval?'确认网页操作':'停止当前任务？'}</h3>
        <p className="mt-2 text-[13px] leading-[1.65] text-paper-muted">{approval||'关闭后本次任务将停止。也可以先收起面板，让任务继续运行。'}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="agent-secondary" onClick={()=>{if(approval)approvalResolve.current?.(false);else setClosePrompt(false)}}>{approval?'拒绝':'继续任务'}</button>
          <button type="button" className="agent-primary" onClick={()=>{if(approval)approvalResolve.current?.(true);else {stop();onClose()}}}>{approval?'允许这一步':'停止并关闭'}</button>
        </div>
      </div>
    </div>}
  </section>
}
