/** Real Android end-to-end smoke: BYOK form -> mock Chat Completions -> native WebView actions. */
import assert from 'node:assert/strict'
import http from 'node:http'
const port=Number(process.env.CDP_PORT||9231)
const fixturePort=Number(process.env.AGENT_FIXTURE_PORT||8765)
let calls=0
const requests=[]
const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/chat/completions' && req.method==='POST'){
    let raw='';for await(const part of req)raw+=part
    const data=JSON.parse(raw)
    requests.push(data)
    const userContent=data.messages[1].content
    const content=JSON.parse(Array.isArray(userContent) ? userContent[0].text : userContent)
    const observation=content.page
    const history=content.priorSteps||[]
    let next
    if(content.goal==='删除条目')next=/Deleted/.test(observation.text)?{action:'finish',answer:'删除动作已完成'}:{action:'click',id:observation.elements.find(x=>x.text==='删除条目')?.id}
    else if(content.goal==='选择类别')next=/Selected:Beta/.test(observation.text)?{action:'finish',answer:'选项已更改'}:{action:'choose',id:observation.elements.find(x=>x.tag==='select')?.id,text:'Beta'}
    else if(content.goal==='视觉点击'){
      if(/VisualTapped/.test(observation.text))next={action:'finish',answer:'视觉点击已完成'}
      else if(history.length===0)next={action:'inspect'}
      else {
        const target=observation.elements.find(x=>x.text==='截图点我')
        next={action:'tap',x:Math.round(target.x*content.screenshot.width/observation.viewport.width),
          y:Math.round(target.y*content.screenshot.height/observation.viewport.height)}
      }
    }
    else if(content.goal==='停止测试'){
      await new Promise(resolve=>setTimeout(resolve,1800))
      next={action:'click',id:observation.elements.find(x=>x.text==='自动更改')?.id}
    }
    else if(content.goal==='打开新标签页')next=history.length?{action:'finish',answer:'新标签页已打开'}:{action:'new_tab',url:`http://10.0.2.2:${fixturePort}/next`}
    else if(content.goal==='切换到首标签')next=history.length?{action:'finish',answer:'已切换到首标签'}:{action:'switch_tab',index:0}
    else if(/Search:Qwen3\.8/.test(observation.text))next={action:'finish',answer:'已在真实网页中搜索 Qwen3.8'}
    else if(history.length===0)next={action:'type',id:observation.elements.find(x=>x.tag==='input')?.id,text:'Qwen3.8'}
    else next={action:'click',id:observation.elements.find(x=>x.tag==='button')?.id}
    calls++
    res.writeHead(200,{'Content-Type':'application/json'})
    res.end(JSON.stringify({id:'mock-response',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(next)},finish_reason:'stop'}]}))
    return
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'})
  if(req.url==='/next'){res.end('<!doctype html><title>Second Tab</title><h1>New tab loaded</h1>');return}
  res.end(`<!doctype html><title>Agent Fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><h1>AI browser test</h1><input id="query" placeholder="搜索资料"><button id="go" onclick="document.getElementById('result').textContent='Search:'+document.getElementById('query').value">搜索</button><p id="result">Idle</p>
    <select id="category" onchange="document.getElementById('selected').textContent='Selected:'+this.options[this.selectedIndex].text"><option value="a">Alpha</option><option value="b">Beta</option></select><p id="selected">None</p>
    <button id="delete" onclick="document.getElementById('deleted').textContent='Deleted'">删除条目</button><p id="deleted">Keep</p>
    <button id="visual" onclick="document.getElementById('visual-result').textContent='VisualTapped'">截图点我</button><p id="visual-result">VisualIdle</p>
    <button id="stop-target" onclick="document.getElementById('stop-result').textContent='Altered'">自动更改</button><p id="stop-result">Safe</p>`)
})
await new Promise(resolve=>server.listen(fixturePort,'0.0.0.0',resolve))
let socket
try{
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target=targets.find(t=>t.url==='https://localhost/'&&t.type==='page')
  assert(target,'main WebView target missing')
  socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  let id=0;const pending=new Map()
  socket.addEventListener('message',evt=>{const data=JSON.parse(evt.data),item=pending.get(data.id);if(!item)return;pending.delete(data.id);if(data.error)item.reject(new Error(JSON.stringify(data.error)));else item.resolve(data.result)})
  function call(method,params){return new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});socket.send(JSON.stringify({id:requestId,method,params}))})}
  async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result?.value}
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  async function waitUntil(expression,{tries=60,interval=300}={}){
    for(let i=0;i<tries;i++){const answer=await evaluate(expression);if(answer)return answer;await wait(interval)}
    const body=await evaluate(`document.body?.innerText?.slice(-1500)`)
    throw new Error(`Timed out waiting for ${expression}; UI=${body}`)
  }
  function click(label){return evaluate(`(()=>{const element=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()==${JSON.stringify(label)});if(!element)return false;element.click();return true})()`)}
  async function fill(selector,value){return evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)}
  try{
    await wait(850)
    await evaluate(`(()=>{const skip=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='稍后再说');if(skip){skip.click();return true}return false})()`)
    await wait(750)
    console.log('Open UI:',await evaluate(`window.dispatchEvent(new CustomEvent('newsnook:open-browser',{detail:{url:'http://10.0.2.2:${fixturePort}/'}}))`))
    await waitUntil(`!!document.querySelector('[aria-label="NewsNook 网页浏览器"]')`)
    await waitUntil(`document.querySelector('[aria-label="AI 浏览助手"]')!==null`)
    await evaluate(`document.querySelector('button[aria-label="AI 浏览助手"]').click()`)
    await waitUntil(`!!document.querySelector('section[aria-label="AI 浏览助手"]')`)
    await waitUntil(`!([...document.querySelectorAll('section[aria-label="AI 浏览助手"] button')].find(el=>el.textContent.trim()==='API 设置')?.disabled)`)
    assert(await click('API 设置'),'API settings button absent')
    await waitUntil(`!!document.querySelector('input[aria-label="Agent Base URL"]')`)
    assert(await fill('input[aria-label="Agent Base URL"]',`http://localhost:${fixturePort}/v1`))
    assert(await fill('input[aria-label="Agent Model"]','mock-agent'))
    assert(await fill('input[aria-label="Agent API Key"]','test-only-key'))
    assert(await click('保存配置'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"] [role="status"]')?.textContent?.includes('配置已保存')`)
    const secure=await evaluate(`window.Capacitor.Plugins.SecureStore.get({key:'browser.agent.apiKey'})`)
    assert.equal(secure.value,'test-only-key')
    const persisted=await evaluate(`JSON.parse(localStorage.getItem('newsnook.browser.agent.config.v1'))`)
    assert.equal(persisted.endpoint,`http://localhost:${fixturePort}/v1`)
    assert.equal(persisted.model,'mock-agent')
    assert(await fill('textarea[aria-label="AI 浏览任务"]','搜索 Qwen3.8'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"]')?.textContent?.includes('开始任务')`)
    assert(await click('开始任务'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"] [role="status"]')?.textContent==='已完成'`,{tries:95,interval:350})
    const result=await evaluate(`document.querySelector('section[aria-label="AI 浏览助手"]')?.textContent?.slice(-250)`)
    assert.match(result,/真实网页中搜索 Qwen3\.8/)
    assert.equal(calls,3)
    assert(await fill('textarea[aria-label="AI 浏览任务"]','打开新标签页'))
    assert(await click('开始任务'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"]')?.textContent?.includes('新标签页已打开')`,{tries:110,interval:350})
    const tabState=await evaluate(`window.Capacitor.Plugins.NewsNookBrowser.tabs()`)
    assert.equal(tabState.tabs.length,2)
    assert.match(tabState.tabs.find(t=>t.active).url,/\/next$/)
    assert(await fill('textarea[aria-label="AI 浏览任务"]','切换到首标签'))
    assert(await click('开始任务'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"]')?.textContent?.includes('已切换到首标签')`,{tries:100,interval:350})
    const switched=await evaluate(`window.Capacitor.Plugins.NewsNookBrowser.tabs()`)
    assert.equal(switched.tabs.find(t=>t.active).index,0)
    assert.equal(calls,7)
    assert(await fill('textarea[aria-label="AI 浏览任务"]','选择类别'))
    assert(await click('开始任务'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"]')?.textContent?.includes('选项已更改')`,{tries:75,interval:350})
    assert(await fill('textarea[aria-label="AI 浏览任务"]','删除条目'))
    assert(await click('开始任务'))
    await waitUntil(`!!document.querySelector('[aria-label="确认 AI 网页操作"]')`,{tries:65,interval:300})
    assert(await click('拒绝'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"] [role="status"]')?.textContent?.includes('本次操作已拒绝')`)
    assert(await fill('textarea[aria-label="AI 浏览任务"]','删除条目'))
    assert(await click('开始任务'))
    await waitUntil(`!!document.querySelector('[aria-label="确认 AI 网页操作"]')`,{tries:65,interval:300})
    assert(await click('允许这一步'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"]')?.textContent?.includes('删除动作已完成')`,{tries:75,interval:350})
    assert(await fill('textarea[aria-label="AI 浏览任务"]','视觉点击'))
    assert(await click('开始任务'))
    await waitUntil(`!!document.querySelector('[aria-label="确认 AI 网页操作"]')`,{tries:75,interval:350})
    assert(await click('允许这一步'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"]')?.textContent?.includes('视觉点击已完成')`,{tries:75,interval:350})
    assert(await fill('textarea[aria-label="AI 浏览任务"]','停止测试'))
    assert(await click('开始任务'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"] [role="status"]')?.textContent?.includes('AI 分析')`,{tries:30,interval:200})
    assert(await click('停止'))
    await wait(2200)
    const stopped=await evaluate(`document.querySelector('section[aria-label="AI 浏览助手"] [role="status"]')?.textContent`)
    assert.equal(stopped,'已停止')
    assert(requests.every(req=>req.model==='mock-agent'))
    console.log('PASS: BYOK, Keystore, mock LLM, DOM/visual tools, dropdown, tabs, approvals and stop')
  }finally{
    try{await evaluate(`window.Capacitor.Plugins.SecureStore.remove({key:'browser.agent.apiKey'})`)}catch{}
    try{await evaluate(`localStorage.removeItem('newsnook.browser.agent.config.v1')`)}catch{}
    try{await evaluate(`([...document.querySelectorAll('section[aria-label="AI 浏览助手"] button')].find(el=>el.textContent.trim()==='关闭'))?.click()`)}catch{}
    try{await evaluate(`document.querySelector('button[aria-label="返回有所闻"]')?.click()`)}catch{}
  }
}finally{socket?.close();await new Promise(resolve=>server.close(resolve))}
