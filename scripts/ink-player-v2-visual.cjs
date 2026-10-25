/* Manual visual verification. Uses local Chrome DevTools; no production dependency. */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const chrome = process.env.CHROME_PATH ||
  (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome')
const port = 9241
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
    await send('Page.navigate',{url:`http://127.0.0.1:5179/scripts/fixtures/ink-player-v2/preview.html?scene=${scene}`})
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
    if(await evaluate(`Boolean(document.querySelector('button[aria-label="媒体资源"]'))`)){
      await click('button[aria-label="媒体资源"]')
      await screenshot('landscape-sources-cdp')
    }
    await setup(1180,850,'floating')
    await screenshot('floating-cdp')
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
