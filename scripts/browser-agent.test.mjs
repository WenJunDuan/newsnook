import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../android/app/src/main/assets/browser-agent.js',import.meta.url),'utf8')
let value=''
const fields={
  input:{tagName:'INPUT',value:'',disabled:false,readOnly:false,getAttribute(k){return k==='placeholder'?'搜索':null},matches(){return false},getBoundingClientRect(){return {width:100,height:30,x:0,y:0}},focus(){},scrollIntoView(){},dispatchEvent(){},innerText:'',isContentEditable:false},
  button:{tagName:'BUTTON',innerText:'执行搜索',value:'',getAttribute(){return null},matches(){return false},getBoundingClientRect(){return {width:80,height:30,x:10,y:10}},scrollIntoView(){},click(){value='clicked'},dispatchEvent(){}}
}
const list=Object.values(fields)
const doc={title:'测试网页',body:{innerText:'搜索页面'},querySelectorAll(){return list}}
function run(args){
  const ctx={document:doc,location:{href:'https://example.com'},innerWidth:400,innerHeight:800,
    getComputedStyle(){return {visibility:'visible',display:'block',opacity:'1'}},window:{scrollBy(){value='scrolled'}},
    Event:class {constructor(){}},KeyboardEvent:class {},HTMLInputElement:class {},HTMLTextAreaElement:class {},JSON,Array,String,Math}
  Object.defineProperty(ctx.HTMLInputElement.prototype,'value',{set(v){this._value=v}})
  Object.setPrototypeOf(fields.input,ctx.HTMLInputElement.prototype)
  const code=source.replace('__ARGS__',JSON.stringify(args))
  return JSON.parse(vm.runInNewContext(code,ctx))
}
assert.equal(run({action:'observe'}).elements.length,2)
assert.equal(run({action:'click',id:1}).ok,true)
assert.equal(value,'clicked')
assert.equal(run({action:'type',id:0,text:'Qwen'}).ok,true)
assert.equal(fields.input._value,'Qwen')
assert.equal(run({action:'scroll',direction:'down'}).ok,true)
assert.equal(value,'scrolled')
assert.match(run({action:'click',id:80}).error,/元素不存在/)
console.log('Browser agent DOM observe/click/type/scroll and invalid element: PASS')
