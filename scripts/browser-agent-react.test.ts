import assert from 'node:assert/strict'
import {AGENT_TOOLS,BROWSER_TOOL_SCHEMAS,runReActAgent,type AgentConfig,type AgentTurnTransport,type AgentToolName,type AgentChatMessage} from '../src/features/browser/agent/browserAgent'

const config:AgentConfig={endpoint:'http://localhost:8765/v1',apiKey:'test',model:'mock'}
const tools=new Set(AGENT_TOOLS.map(item=>item.name))
for(const tool of BROWSER_TOOL_SCHEMAS){
  assert(tools.has(tool.function.name))
  assert.equal(tool.type,'function')
  assert.equal(tool.function.parameters.type,'object')
}
async function testAutonomy(){
  const actions:Array<{name:string;args:unknown}>=[]
  let turn=0
  const transport:AgentTurnTransport=async (_config,messages)=>{
    assert.equal(messages[0].role,'system')
    assert.equal(JSON.parse(messages[1].content as string).task,'搜索最新模型，再进入讨论')
    const latest=messages.at(-1)
    if(turn===0){
      assert.equal(messages.length,2,'task starts without forcing an observe or open action')
      turn++
      return {content:null,tool_calls:[{id:'search-1',type:'function',function:{name:'browser_search',arguments:JSON.stringify({query:'Qwen 下一代 最新'})}}]}
    }
    if(turn===1){
      assert.equal(latest?.role,'tool')
      assert.equal(latest.tool_call_id,'search-1')
      assert.match(latest.content as string,/搜索结果/)
      turn++
      return {content:null,tool_calls:[{id:'open-2',type:'function',function:{name:'browser_click',arguments:'{"id":4}'}}]}
    }
    assert.equal(latest?.role,'tool')
    assert.equal(latest.tool_call_id,'open-2')
    assert.match(latest.content as string,/帖子/)
    return {content:'已阅读讨论，找到最新模型观点。'}
  }
  const result=await runReActAgent(config,'搜索最新模型，再进入讨论',{state:{url:null},tabs:[]},{
    performTool:async(name:AgentToolName,args)=>{
      actions.push({name,args})
      if(name==='browser_search')return {result:{page:'搜索结果'}}
      if(name==='browser_click')return {result:{page:'帖子内容'}}
      throw new Error('unexpected tool')
    },
  },new AbortController().signal,transport)
  assert.equal(result,'已阅读讨论，找到最新模型观点。')
  assert.deepEqual(actions.map(item=>item.name),['browser_search','browser_click'])
}
async function testErrorRecovery(){
  let iteration=0
  const transport:AgentTurnTransport=async(_config,messages:AgentChatMessage[])=>{
    iteration++
    if(iteration===1)return {content:null,tool_calls:[{id:'oops',type:'function',function:{name:'browser_click',arguments:'{"id":99}'}}]}
    if(iteration===2){assert.match(messages.at(-1)?.content as string,/无法找到元素/)
      return {content:null,tool_calls:[{id:'recover',type:'function',function:{name:'browser_observe',arguments:'{}'}}]}}
    return {content:'已完成重试'}
  }
  const result=await runReActAgent(config,'重试任务',{},
    {performTool:async name=>name==='browser_click'?Promise.reject(new Error('无法找到元素')):Promise.resolve({result:{page:'ok'}})},
    new AbortController().signal,transport)
  assert.equal(result,'已完成重试')
}
async function testAbort(){
  const controller=new AbortController()
  const transport:AgentTurnTransport=async()=>({content:null,tool_calls:[{id:'slow',type:'function',function:{name:'browser_search',arguments:'{"query":"test"}'}}]})
  await assert.rejects(()=>runReActAgent(config,'取消',{},
    {performTool:async()=>{controller.abort();return {result:{ok:true}}}},controller.signal,transport),/任务已停止/)
}
async function testMultipleToolsWithScreenshot(){
  let turns=0
  const transport:AgentTurnTransport=async(_config,messages)=>{
    if(turns++===0)return {content:null,tool_calls:[
      {id:'screen',type:'function',function:{name:'browser_screenshot',arguments:'{}'}},
      {id:'tabs',type:'function',function:{name:'browser_tabs',arguments:'{}'}},
    ]}
    const roles=messages.map(msg=>msg.role)
    assert.deepEqual(roles,['system','user','assistant','tool','tool','user'])
    assert.equal(messages[3].tool_call_id,'screen')
    assert.equal(messages[4].tool_call_id,'tabs')
    assert(Array.isArray(messages[5].content))
    assert.equal(messages[5].content[1].type,'image_url')
    return {content:'视觉检查完成'}
  }
  const answer=await runReActAgent(config,'观察网页',{}, {
    performTool:async name=>name==='browser_screenshot'
      ? {result:{width:4,height:4},screenshot:{image:'abc',width:4,height:4,viewWidth:400,viewHeight:400}}
      : {result:{tabs:[]}},
  },new AbortController().signal,transport)
  assert.equal(answer,'视觉检查完成')
}
await testAutonomy()
await testErrorRecovery()
await testAbort()
await testMultipleToolsWithScreenshot()
console.log('ReAct tool selection, feedback, multi-tool screenshot ordering, recovery, abort and schema: PASS')
