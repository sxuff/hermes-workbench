import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkbenchClient} from '../src/client';
import {createInitialWorkbenchState,workbenchReducer as reduce} from '../src/state';
const snapshot={session_id:'a',stored_session_id:'stored-a',info:{},messages:[]};
const initial=()=>reduce(createInitialWorkbenchState(),{type:'session.bound',session:snapshot});
const event=(s:any,type:string,payload:any)=>reduce(s,{type:'event',event:{session_id:'a',type,payload}});
const tick=()=>new Promise<void>(r=>setImmediate(r));
class FixtureSocket {
 readyState=0;sent:any[]=[];handlers=new Map<string,Function[]>();
 addEventListener(t:string,h:Function){this.handlers.set(t,[...(this.handlers.get(t)||[]),h])}
 emit(t:string,e:any={}){for(const h of this.handlers.get(t)||[])h(e)}
 send(s:string){this.sent.push(JSON.parse(s))}
 open(){this.readyState=1;this.emit('open')}
 close(){this.readyState=3;this.emit('close',{code:1006})}
 reply(result:any){this.emit('message',{data:JSON.stringify({id:this.sent.at(-1).id,result})})}
 event(type:string,payload:any){this.emit('message',{data:JSON.stringify({method:'event',params:{session_id:'a',type,payload,seq:2}})})}
}
test('review regression: native clarification, sudo and secret expiration remove exact requests',()=>{
 for(const kind of ['clarify','sudo','secret']){let s=initial();s=event(s,kind+'.request',{request_id:'expired'});s=event(s,kind+'.request',{request_id:'keep'});s=event(s,kind+'.expire',{request_id:'expired'});assert.deepEqual(s.threads.a.requests.map(r=>r.request_id),['keep'])}
});
test('review regression: final usage wins and snapshot-complete replay does not duplicate history',()=>{
 let s=initial();s=event(s,'session.usage',{tokens:1});s=event(s,'message.complete',{text:'done',usage:{tokens:7,cost:0.01}});s=event(s,'message.complete',{text:'done',usage:{tokens:7,cost:0.01}});assert.equal(s.threads.a.messages.length,1);assert.deepEqual(s.threads.a.usage,{tokens:7,cost:0.01});
});
test('review regression: terminal event during resume survives older running snapshot',async()=>{
 const sockets:FixtureSocket[]=[];
 const client=new WorkbenchClient({api:{buildWsUrl:()=> 'ws://fixture.invalid/api/ws',getSessionLatestDescendant:async(id:string)=>({session_id:id,changed:false})}},{socketFactory:()=>{const s=new FixtureSocket();sockets.push(s);return s as any},autoReconnect:false,heartbeatIntervalMs:0});
 try {let p=client.connect();await tick();sockets[0].open();await p;const created=client.createSession();sockets[0].reply(snapshot);await created;sockets[0].close();p=client.connect();await tick();const s=sockets[1];s.open();await tick();s.reply({sessions:[{id:'a',session_key:'stored-a'}]});await tick();assert.equal(s.sent.at(-1).method,'session.resume');s.event('message.complete',{text:'finished',usage:{tokens:99}});s.reply({...snapshot,running:true,inflight:{assistant:'old partial'}});await tick();assert.equal(s.sent.at(-1).method,'approval.pending');s.reply({approvals:[]});await p;assert.equal(client.state.threads.a.running,false);assert.equal(client.state.threads.a.messages.at(-1)?.text,'finished');assert.equal(client.state.threads.a.usage.tokens,99)}finally{client.disconnect()}
});
test('review regression: ancestor lineage is rejected before native resume can bind transport',async()=>{
 const client=new WorkbenchClient({api:{getSessionLatestDescendant:async()=>({session_id:'newer',changed:true})}});
 await assert.rejects(client.resumeSession('ancestor'),/newer continuation/);assert.deepEqual(client.state.threads,{});
});
