/* Manual visual verification. Uses local Chrome DevTools; no production dependency. */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const chrome = process.env.CHROME_PATH ||
  (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome')
const port = 9241
const previewPort = Number(process.env.INK_PLAYER_PREVIEW_PORT || 5179)
const evidenceDir = path.resolve('evidence/ink-player-v2')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-player-v2-cdp-'))
const args = ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--remote-allow-origins=*', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', 'about:blank']
const child = spawn(chrome, args, { stdio:'ignore' })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function connect() {
  let target
  for (let attempt=0; attempt<35; attempt++) {
    try {
      const response=await fetch(`http://127.0.0.1:${port}/json/list`)
      target=(await response.json()).find(item=>item.type==='page')
      if(target) break
    } catch {}
    await pause(200)
  }
  if(!target) throw new Error('Chrome DevTools connection failed')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let sequence=0
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  ws.onmessage=evt=>{
    const payload=JSON.parse(evt.data)
    if(!payload.id)return
    const item=pending.get(payload.id)
    if(!item)return
    pending.delete(payload.id)
    if(payload.error)item.reject(new Error(JSON.stringify(payload.error)))
    else item.resolve(payload.result)
  }
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))
  })
  return {send,close:()=>ws.close()}
}
async function main(){
  const {send,close}=await connect()
  await send('Page.enable')
  await send('Runtime.enable')
  async function evaluate(expression) {
    const out=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(out.exceptionDetails)throw new Error(out.exceptionDetails.text)
    return out.result?.value
  }
  async function setup(width,height,scene='inline') {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500})
    await send('Page.navigate',{url:'about:blank'})
    await pause(160)
    await send('Page.navigate',{url:`http://127.0.0.1:${previewPort}/scripts/fixtures/ink-player-v2/preview.html?scene=${scene}`})
    let ready = false
    for (let probe = 0; probe < 35; probe++) {
      ready = await evaluate(`location.search.includes('scene=${scene}') && Boolean(document.querySelector('[data-video-stage] video'))`)
      if (ready) break
      await pause(250)
    }
    if(!ready)throw new Error('Player not mounted: '+scene+' '+await evaluate("JSON.stringify({url:location.href,ready:document.readyState,html:document.body?.innerHTML.slice(0,380),overlay:document.querySelector('vite-error-overlay')?.shadowRoot?.innerText?.slice(0,300)})"))
    if (scene === 'inline') {
      for (let probe=0;probe<35;probe++) {
        if (await evaluate("Boolean(document.querySelector('button[aria-label=\"全屏\"]'))")) break
        await pause(150)
      }
    }
  }
  async function screenshot(name) {
    const out=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true})
    fs.writeFileSync(path.join(evidenceDir,name+'.png'),Buffer.from(out.data,'base64'))
    const metrics=await evaluate(`JSON.stringify({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,stage:(()=>{const e=document.querySelector('[data-video-stage]');const r=e?.getBoundingClientRect();return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom}:null})()})`)
    console.log(name,metrics)
  }
  async function click(selector) {
    const xy=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'end'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    if(!xy)throw new Error('Missing '+selector)
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:xy.x,y:xy.y,button:'left',clickCount:1})
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:xy.x,y:xy.y,button:'left',clickCount:1})
    await pause(550)
  }
  try{
    await setup(393,852)
    await screenshot('mobile-inline-cdp')
    await click('button[aria-label="全屏"]')
    console.log('mobile fullscreen',await evaluate("JSON.stringify({fullscreen:Boolean(document.fullscreenElement),data:document.querySelector('[data-video-fullscreen]')?.dataset.videoFullscreen})"))
    await screenshot('mobile-fullscreen-cdp')
    await setup(844,390)
    await click('button[aria-label="全屏"]')
    await screenshot('landscape-fullscreen-cdp')
    // Browser compositor proof: real touch events, including first-stroke downward
    // drags and a two-finger pinch with separate finger release events.
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
    const gestureBox = JSON.parse(await evaluate(`JSON.stringify((()=>{const r=document.querySelector('[data-video-gesture-surface]')?.getBoundingClientRect();return r?{left:r.left,top:r.top,width:r.width,height:r.height}:null})())`))
    if (!gestureBox || gestureBox.width < 100) throw new Error('Missing fullscreen gesture surface')
    const pt=(id,x,y)=>({id,x:Math.round(gestureBox.left+gestureBox.width*x),y:Math.round(gestureBox.top+gestureBox.height*y)})
    const touch=async(type,points)=>{
      await send('Input.dispatchTouchEvent',{type,touchPoints:points})
      await pause(90)
    }
    const getHud=async()=>await evaluate("document.querySelector('[data-ink-hud]')?.getAttribute('data-ink-hud') || ''")
    await touch('touchStart',[pt(1,.15,.22)])
    await touch('touchMove',[pt(1,.15,.40)])
    if (await getHud() !== 'brightness') throw new Error('First downward left stroke must immediately adjust brightness')
    await screenshot('touch-brightness-down-cdp')
    await touch('touchEnd',[])
    await pause(640)
    if(await getHud())throw new Error('Brightness HUD did not dismiss')

    await touch('touchStart',[pt(2,.82,.22)])
    await touch('touchMove',[pt(2,.82,.42)])
    if(await getHud()!=='volume')throw new Error('First downward right stroke must immediately adjust volume')
    await touch('touchEnd',[])
    await pause(640)
    if(await getHud())throw new Error('Volume HUD did not dismiss')
    // Restore the fallback brightness before recording the separate zoom case.
    await touch('touchStart',[pt(5,.18,.49)])
    await touch('touchMove',[pt(5,.18,.14)])
    await touch('touchEnd',[])
    await pause(650)

    await touch('touchStart',[pt(3,.41,.52)])
    await touch('touchStart',[pt(3,.41,.52),pt(4,.59,.52)])
    await touch('touchMove',[pt(3,.36,.52),pt(4,.68,.52)])
    if(await getHud()!=='center')throw new Error('Pinch did not show a zoom HUD')
    await screenshot('touch-zoom-hud-cdp')
    await touch('touchEnd',[pt(4,.68,.52)])
    await touch('touchEnd',[])
    await pause(700)
    if(await getHud())throw new Error('Zoom HUD did not dismiss after all fingers lifted')
    await screenshot('touch-zoom-dismissed-cdp')
    await send('Emulation.setTouchEmulationEnabled',{enabled:false})
    if(await evaluate(`Boolean(document.querySelector('button[aria-label="媒体资源"]'))`)){
      await click('button[aria-label="媒体资源"]')
      await screenshot('landscape-sources-cdp')
    }
    await setup(1180,850,'floating')
    await screenshot('floating-cdp')
    await setup(393,852,'floating')
    await pause(2850)
    const floatMetrics = JSON.parse(await evaluate(`JSON.stringify((()=>{const f=document.querySelector('[data-floating-video-window]');const s=f?.querySelector('[data-video-stage]');const r=f?.getBoundingClientRect();const sr=s?.getBoundingClientRect();return {width:r?.width,height:r?.height,stageHeight:sr?.height,titlebar:Boolean(f?.querySelector('.floating-video-titlebar')),actions:f?.querySelectorAll('.floating-video-actions button').length,resize:Boolean(f?.querySelector('[aria-label="调整悬浮窗口大小"]')),seekRight:f?.querySelector('.ink-seek')?.getBoundingClientRect().right,resizeLeft:f?.querySelector('.floating-video-resize')?.getBoundingClientRect().left}})())`))
    console.log('mobile floating geometry',JSON.stringify(floatMetrics))
    if (!floatMetrics.width || Math.abs(floatMetrics.height-floatMetrics.width*9/16)>2 || Math.abs(floatMetrics.height-floatMetrics.stageHeight)>2 || floatMetrics.titlebar || floatMetrics.actions!==2 || !floatMetrics.resize || floatMetrics.seekRight > floatMetrics.resizeLeft+1) throw new Error('Floating player geometry, controls or seek/resize zones overlap')
    await screenshot('mobile-floating-cdp')
    const didPlay = await evaluate(`(async()=>{const video=document.querySelector('[data-floating-video-window] video');if(!video)return false;video.muted=true;try{await video.play();return !video.paused}catch{return false}})()`)
    if (didPlay) {
      await pause(2950)
      const isHidden=await evaluate(`document.querySelector('[data-floating-video-window]')?.dataset.floatingChrome==='hidden'`)
      if(!isHidden)throw new Error('Floating controls should fade away during uninterrupted playback')
      await screenshot('mobile-floating-playing-cdp')
    }
    await setup(1180,850,'page')
    await screenshot('standalone-cdp')
    const pageResources = await evaluate("JSON.stringify({button:Boolean(document.querySelector('button[aria-label=\"媒体资源\"]')),fab:Boolean(document.querySelector('.ink-player-resource-fab')),duplicatedTitle:!!document.querySelector('[data-video-page=\"true\"] .ink-video-title') && getComputedStyle(document.querySelector('[data-video-page=\"true\"] .ink-video-title')).display !== 'none'})")
    console.log('standalone controls',pageResources)
    const detail = JSON.parse(pageResources)
    if (!detail.button || detail.fab || detail.duplicatedTitle) throw new Error('Standalone layout regression')
    await click('button[aria-label="媒体资源"]')
    const sourcePanel = await evaluate("Boolean(document.querySelector('[data-ink-player-source-sheet]'))")
    if (!sourcePanel) throw new Error('Standalone source panel not available')
    await screenshot('standalone-sources-cdp')
  }finally{close()}
}
main().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>{
  child.kill()
  try{fs.rmSync(profile,{recursive:true,force:true})}catch{}
})
