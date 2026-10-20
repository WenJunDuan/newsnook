/** Real Android WebView + Capacitor bridge integration smoke test. Run against an isolated debug emulator. */
import assert from 'node:assert/strict'
import http from 'node:http'
const port=process.env.CDP_PORT||'9231'
const fixturePort=Number(process.env.AGENT_FIXTURE_PORT||8765)
const hostname='10.0.2.2'
const url=`http://${hostname}:${fixturePort}/`
const server=http.createServer((request,response)=>{
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'})
  if(request.url==='/long') {
    const paragraphs=Array.from({length:30},(_,i)=>`<p>section-${i} content</p>`).join('')
    response.end(`<html><title>Long Page</title><meta name="viewport" content="width=device-width,initial-scale=1"><div style="height:180px;width:100%;overflow:auto">${paragraphs}<p>Agent bottom marker</p></div></html>`)
    return
  }
  if(request.url==='/next') { response.end('<!doctype html><title>Next Page</title><h1>Destination reached</h1><button id="success" onclick="document.title=\'Clicked Target\'">Confirm</button>');return }
  response.end(`<!doctype html><title>Agent Fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><h1>AI browser test</h1>
  <label>Search <input placeholder="搜索资料" id="search"></label>
  <button id="go" onclick="document.getElementById('result').textContent='Search:'+document.getElementById('search').value">搜索</button>
  <p id="result">Idle</p><a href="/next">Next page</a>`)
})
await new Promise(resolve=>server.listen(fixturePort,'0.0.0.0',resolve))
let socket
try{
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target=targets.find(t=>t.type==='page'&&t.url==='https://localhost/')
  if(!target)throw new Error('NewsNook main WebView target unavailable')
  socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  let id=0;const pending=new Map()
  socket.addEventListener('message',event=>{const obj=JSON.parse(event.data);const p=pending.get(obj.id);if(!p)return;pending.delete(obj.id);if(obj.error)p.reject(new Error(JSON.stringify(obj.error)));else p.resolve(obj.result)})
  async function cdp(method,params){return new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}))})}
  async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result?.value}
  async function plugin(method,opts={}){return evaluate(`window.Capacitor.Plugins.NewsNookBrowser.${method}(${JSON.stringify(opts)})`)}
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  try {
    await plugin('open',{url,embedded:true,visible:true,top:0,bottom:0,palette:{},scripts:[],settings:{userAgentMode:'system',javaScriptEnabled:true,loadsImagesAutomatically:true}})
    let tab=await plugin('state')
    console.log('Open:',tab)
    assert.equal(tab.url,url)
    let observation
    for(let attempt=0;attempt<20;attempt++){
      await wait(350)
      observation=(await plugin('agentAction',{action:'observe',tabId:tab.tabId})).result
      if(observation.title==='Agent Fixture')break
    }
    console.log('Ready:',{title:observation.title,url:observation.url,body:observation.text.slice(0,100),state:await plugin('state')})
    assert.equal(observation.title,'Agent Fixture')
    const input=observation.elements.find(x=>x.tag==='input')
    const button=observation.elements.find(x=>x.tag==='button')
    assert(input&&button)
    assert.deepEqual((await plugin('agentAction',{action:'type',tabId:tab.tabId,id:input.id,text:'Qwen3.8',snapshot:observation.snapshot})).result,{ok:true})
    assert.deepEqual((await plugin('agentAction',{action:'click',tabId:tab.tabId,id:button.id,snapshot:observation.snapshot})).result,{ok:true})
    observation=(await plugin('agentAction',{action:'observe',tabId:tab.tabId})).result
    assert.match(observation.text,/Search:Qwen3\.8/)
    const image=(await plugin('agentAction',{action:'screenshot',tabId:tab.tabId})).result
    assert(image.image?.length>1000&&image.viewWidth>0&&image.width>0)
    const link=observation.elements.find(x=>x.href==='/next')
    assert(link)
    await plugin('agentAction',{action:'click',tabId:tab.tabId,id:link.id,snapshot:observation.snapshot})
    await wait(900)
    observation=(await plugin('agentAction',{action:'observe',tabId:tab.tabId})).result
    assert.match(observation.url,/\/next$/)
    assert.equal(observation.title,'Next Page')
    const imageForNext=(await plugin('agentAction',{action:'screenshot',tabId:tab.tabId})).result
    const targetButton=observation.elements.find(x=>x.text==='Confirm')
    assert(targetButton)
    await plugin('agentAction',{action:'tap',tabId:tab.tabId,x:Math.round(targetButton.x*imageForNext.viewWidth/observation.viewport.width),y:Math.round(targetButton.y*imageForNext.viewHeight/observation.viewport.height),snapshot:observation.snapshot})
    await wait(300)
    observation=(await plugin('agentAction',{action:'observe',tabId:tab.tabId})).result
    assert.equal(observation.title,'Clicked Target')
    await plugin('navigate',{action:'url',url:url+'long'})
    await wait(550)
    let longView
    for(let attempt=0;attempt<25;attempt++){
      longView=(await plugin('agentAction',{action:'observe',tabId:tab.tabId})).result
      if(longView.title==='Long Page')break
      await wait(300)
    }
    assert.equal(longView.title,'Long Page')
    assert(!longView.text.includes('Agent bottom marker') || longView.text.indexOf('Agent bottom marker')>500)
    let found=false
    for(let step=0;step<15;step++){
      const scrollResult=(await plugin('agentAction',{action:'scroll',tabId:tab.tabId,direction:'down',snapshot:longView.snapshot})).result
      assert(scrollResult.ok)
      await wait(80)
      longView=(await plugin('agentAction',{action:'observe',tabId:tab.tabId})).result
      if(longView.text.startsWith('[当前可见内容]')&&longView.text.includes('Agent bottom marker')){found=true;break}
    }
    assert(found,'reading visible text after scrolling must reach article bottom')
    console.log('PASS: real WebView observe, type, click, follow link, screenshot, native tap, long-page scroll')
  }finally{try{await plugin('close')}catch{}}
}finally{socket?.close();await new Promise(resolve=>server.close(resolve))}
