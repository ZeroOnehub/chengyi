'use strict';
(() => {
const $=id=>document.getElementById(id), bench=window.PotteryWorkbench;
if(!bench){$('agent-progress').textContent='3D 画布未启动，暂时无法执行指令。';return;}
const KEY='taowu-backend-session-v1', DIRTY='taowu-pending-document-v1';
let credentials=null,project=null,busy=false,revisionGeneration=0,network=null,audioNetwork=null,closed=false;
let serial=Promise.resolve(), snapshots=[], syncing=false, syncError=null, applying=false;
const executed=new Set(), files=[];
const player=new HeritagePCMPlayer({onStart(){progress('正在朗读回复…');},onFinish(){if(!busy)progress('操作已完成。');$('agent-stop').disabled=!busy&&!audioNetwork;},onBlocked(){progress('声音已准备好，请点击“朗读回复”重新开启播放。');}});
function progress(text){$('agent-progress').textContent=text;}
function message(text,kind='',source=''){
 const entry=document.createElement('p');entry.className='agent-message '+kind;entry.textContent=text;
 if(source){const label=document.createElement('span');label.className='agent-source';label.textContent=source;entry.append(label);}
 $('agent-messages').append(entry);while($('agent-messages').children.length>8)$('agent-messages').firstElementChild.remove();$('agent-messages').scrollTop=$('agent-messages').scrollHeight;
}
function setBusy(value){busy=value;$('agent-send').disabled=value||!project;$('agent-record').disabled=value||!project;$('agent-stop').disabled=!value&&!audioNetwork&&!player.sources.size;for(const id of ['outline-shape','outline-roundness','outline-aspect'])$(id).disabled=value||!project;}
async function api(path,body,signal){
 const response=await fetch('/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(credentials?{'X-Session-Token':credentials.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal});
 const value=await response.json();if(!response.ok){const error=Error(value.error?.message||'后台请求没有完成');error.status=response.status;throw error;}return value.data;
}
function route(suffix=''){return '/workbenches/'+project.id+suffix;}
function storeSession(){sessionStorage.setItem(KEY,JSON.stringify({id:project.id,token:credentials.token}));}
function accept(value,{render=false}={}){
 project=value.project;bench.setHistory(project);if(render){applying=true;try{bench.applyState(project.document,project);}finally{applying=false;}}storeSession();
 $('agent-connection').textContent='后台已连接';
}
function inSerial(fn){const next=serial.then(fn,fn);serial=next.catch(()=>{});return next;}
async function boot(){
 try{
  try{credentials=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch{}
  let value;
  if(credentials){try{value=await api('/workbenches/'+credentials.id);}catch(error){if(![404,410].includes(error.status))throw error;credentials=null;}}
  const dirty=sessionStorage.getItem(DIRTY);
  if(!value){value=await api('/workbenches',{document:bench.getState()});credentials={token:value.session_token};accept(value);sessionStorage.removeItem(DIRTY);}
  else{
   accept(value,{render:!dirty});
   // A reload invalidates in-flight operations instead of replaying downloads or old edits.
   accept(await api(route('/cancel'),{}));
   if(dirty){const document=JSON.parse(dirty);applying=true;try{bench.applyState(document);}finally{applying=false;}snapshots.push(document);await flushSnapshots();}
  }
  setBusy(false);progress('可以输入指令，或按住按钮说话。');
 }catch(error){message(error.message,'error');$('agent-connection').textContent='连接失败';progress('手动塑形仍会保存在本机；重新打开页面可重试连接。');setBusy(false);}
}
async function flushSnapshots(){
 if(syncing)return;syncing=true;
 try{
  while(snapshots.length){
   const document=snapshots[0],body={expected_revision:project.revision,client_request_id:crypto.randomUUID(),document};
   let value;
   try{value=await api(route('/sync'),body);}
   catch(error){if(error.status!==409)throw error;accept(await api(route('/cancel'),{}));body.expected_revision=project.revision;value=await api(route('/sync'),body);}
   snapshots.shift();accept(value);if(!snapshots.length)sessionStorage.removeItem(DIRTY);
  }
  syncError=null;
 }catch(error){syncError=error;progress('修改已保存在本机，后台同步未完成：'+error.message);throw error;}
 finally{syncing=false;}
}
bench.subscribe(document=>{
 if(applying||closed)return;
 revisionGeneration++;network?.abort();recognition?.abort();stopAudio();snapshots.push(document);sessionStorage.setItem(DIRTY,JSON.stringify(document));
 if(!project)return;
 void inSerial(async()=>{if(!snapshots.length)return;accept(await api(route('/cancel'),{}));await flushSnapshots();}).catch(()=>{});
});
async function applyCommand(command,generation){
 if(command.status==='answered'){message(command.message,'',command.source==='dify'?'Dify Agent 回答':'助手回答');void speak(command.id);return;}
 if(command.status!=='pending'||executed.has(command.id))return;
 if(generation!==revisionGeneration||command.revision!==project.revision||Date.parse(command.expires_at)<=Date.now())throw Error('工作台已经发生变化，旧指令已取消。');
 const before=bench.getState(),artifacts=[];let receipt;
 try{
  applying=true;document.body.classList.add('remote-applying');bench.applyState(command.document);
  // Export the actual Three.js mesh/canvas, never a model-provided fake URL.
  for(const effect of command.effects)if(effect.type==='export_artifact')artifacts.push(await bench.exportArtifact(effect.format));
  if(generation!==revisionGeneration)throw Error('工作台发生变化，本次操作已取消。');
  const actual=bench.getState();
  receipt={expected_revision:command.revision,status:'applied',document:actual,artifacts:artifacts.map(({format,filename,bytes})=>({format,filename,bytes}))};
  // Retry only the same receipt; never execute or export twice after a lost response.
  let value;try{value=await api(route('/commands/'+command.id+'/receipt'),receipt);}catch(error){if(error.status)throw error;value=await api(route('/commands/'+command.id+'/receipt'),receipt);}
  executed.add(command.id);accept(value);bench.setHistory(project);if(generation!==revisionGeneration)return;
  for(const artifact of artifacts){const href=URL.createObjectURL(artifact.blob),link=document.createElement('a');link.href=href;link.download=artifact.filename;link.textContent='下载 '+artifact.filename+' · '+Math.ceil(artifact.bytes/1024)+' KB';$('agent-files').append(link);files.push(href);while(files.length>3){URL.revokeObjectURL(files.shift());$('agent-files').firstElementChild?.remove();}}
  message(command.message,'',command.source==='dify'?'Dify Agent · 工作台已执行':command.source==='tool'?'工具调用 · 工作台已执行':'工作台已执行');
  progress('操作已完成。');void speak(command.id);
 }catch(error){
  // If a receipt may have committed, read the confirmed document before deciding to restore.
  try{const value=await api(route());accept(value,{render:true});if(value.pending.some(c=>c.id===command.id))accept(await api(route('/commands/'+command.id+'/receipt'),{expected_revision:command.revision,status:'failed'}));}
  catch{bench.applyState(before);}
  throw error;
 }finally{applying=false;document.body.classList.remove('remote-applying');}
}
async function send(text,tool=null){
 text=text.trim();if(!text||busy||!project)return;
 bench.prepareForCommand();revisionGeneration++;const generation=revisionGeneration;stopAudio();player.unlock();setBusy(true);message(text,'user');$('agent-input').value='';progress(tool?'正在调整形状…':'正在理解指令…');network=new AbortController();const signal=network.signal;
 try{
  await inSerial(()=>flushSnapshots());if(syncError)throw syncError;
  const value=await api(route(tool?'/tools/'+tool.name:'/commands'),{...(tool?{arguments:tool.arguments}:{text}),expected_revision:project.revision,client_request_id:crypto.randomUUID()},signal);
  if(generation!==revisionGeneration)return;
  accept(value);await applyCommand(value.command,generation);
 }catch(error){
  try{await inSerial(async()=>accept(await api(route('/cancel'),{})));}catch{}
  if(error.name!=='AbortError'){message(error.message,'error');progress('本次指令没有完成。');}
 }
 finally{network=null;setBusy(false);bench.refreshShapeControls();}
}
bench.onCommand=text=>{if(busy){progress('正在处理上一条指令，可点击停止后再操作。');return;}void send(text);};
bench.onTool=(name,args,label)=>{if(busy){bench.refreshShapeControls();return;}void send(label,{name,arguments:args});};
$('agent-form').onsubmit=event=>{event.preventDefault();void send($('agent-input').value);};
$('agent-input').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send($('agent-input').value);}};
function stopAudio(){audioNetwork?.abort();audioNetwork=null;player.reset();$('agent-stop').disabled=!busy;}
async function speak(commandId){
 if(!$('agent-read').checked)return;
 stopAudio();const controller=new AbortController();audioNetwork=controller;$('agent-stop').disabled=false;
 try{
  const response=await fetch('/api/v1'+route('/speech'),{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':credentials.token},body:JSON.stringify({command_id:commandId}),signal:controller.signal});
  if(!response.ok){const body=await response.json();throw Error(body.error?.message||'声音生成失败');}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done}).replace(/\r\n/g,'\n');let split;
   while((split=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);const event=frame.match(/^event: (.+)$/m)?.[1],raw=frame.match(/^data: (.+)$/m)?.[1];if(!raw)continue;const packet=JSON.parse(raw);if(event==='audio_chunk')player.append(packet);if(event==='voice_done')player.finish();if(event==='speech_error')throw Error(packet.message);}
   if(done)break;
  }
 }catch(error){if(error.name!=='AbortError')progress('工作台操作已完成，声音未完成：'+error.message);}
 finally{if(audioNetwork===controller)audioNetwork=null;$('agent-stop').disabled=!busy&&!player.sources.size;}
}
$('agent-read').onchange=()=>{if(!$('agent-read').checked)stopAudio();else player.resume();};
$('agent-stop').onclick=()=>{revisionGeneration++;network?.abort();recognition?.abort();held=false;void endRecording(false);stopAudio();progress('已停止当前请求和朗读。');if(project)void inSerial(async()=>accept(await api(route('/cancel'),{}))).catch(error=>message(error.message,'error'));};
document.addEventListener('keydown',event=>{if(document.body.classList.contains('remote-applying')&&!event.target.closest('#agent-panel')){event.preventDefault();event.stopImmediatePropagation();}},true);
// Tool calls received through HTTP can also reach this currently open workbench.
setInterval(()=>{if(closed||busy||syncing||snapshots.length||!project||bench.isEditing())return;void inSerial(async()=>{
 if(busy||snapshots.length)return;const value=await api(route());
 if(value.project.revision!==project.revision)accept(value);
 if(value.pending.length){setBusy(true);try{await applyCommand(value.pending[0],revisionGeneration);}finally{setBusy(false);}}
 }).catch(error=>{if(error.status===410){project=null;setBusy(false);progress('会话已过期，请重新打开页面。');}});
},2000);
let held=false,recording=null,recognition=null;
function wav(parts,total){const bytes=new ArrayBuffer(44+total*2),v=new DataView(bytes);const word=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));word(0,'RIFF');v.setUint32(4,36+total*2,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,total*2,true);let at=44;for(const part of parts)for(const s of part){const sample=Math.max(-1,Math.min(1,s));v.setInt16(at,sample<0?sample*32768:sample*32767,true);at+=2;}return new Blob([bytes],{type:'audio/wav'});}
async function beginRecording(){
 if(busy||recording||!project)return;held=true;bench.pauseForVoice();setBusy(true);$('agent-record').disabled=false;stopAudio();player.unlock();progress('正在准备麦克风…');let context,stream,node;
 try{
  context=new AudioContext({sampleRate:16000});await context.resume();stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
  if(!held){stream.getTracks().forEach(t=>t.stop());await context.close();setBusy(false);return;}
  if(context.sampleRate!==16000)throw Error('浏览器不支持录音格式，请使用新版 Chrome。');await context.audioWorklet.addModule('/recording-worklet.js');
  if(!held){stream.getTracks().forEach(t=>t.stop());await context.close();setBusy(false);return;}
  const source=context.createMediaStreamSource(stream);node=new AudioWorkletNode(context,'heritage-recorder');const active={context,stream,node,source,parts:[],total:0};recording=active;
  node.port.onmessage=event=>{if(recording!==active)return;if(event.data.flushed){active.flush?.();return;}const part=event.data.subarray(0,480000-active.total);active.parts.push(part);active.total+=part.length;progress('正在录音 · '+(active.total/16000).toFixed(1)+' 秒');if(active.total>=480000)void endRecording(true);};source.connect(node);node.connect(context.destination);$('agent-record').textContent='松开发送';$('agent-record').classList.add('recording');
 }catch(error){held=false;stream?.getTracks().forEach(t=>t.stop());node?.disconnect();await context?.close().catch(()=>{});recording=null;setBusy(false);progress(error.name==='NotAllowedError'?'麦克风权限未开启。':error.message);}
}
async function endRecording(sendNow){
 held=false;const active=recording;if(!active)return;if(!sendNow)active.cancelled=true;if(active.finishing)return;active.finishing=true;
 await new Promise(resolve=>{active.flush=resolve;active.node.port.postMessage('flush');setTimeout(resolve,150);});recording=null;active.node.port.onmessage=null;active.source.disconnect();active.node.disconnect();active.stream.getTracks().forEach(t=>t.stop());await active.context.close().catch(()=>{});$('agent-record').textContent='按住说话';$('agent-record').classList.remove('recording');
 if(!sendNow||active.cancelled||active.total<3200){setBusy(false);progress(active.total<3200?'录音太短，请重新说一次。':'录音已取消。');return;}
 const controller=new AbortController();recognition=controller;progress('正在识别语音…');
 try{
  const response=await fetch('/api/v1/sessions/'+project.session_id+'/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav','X-Session-Token':credentials.token},body:wav(active.parts,active.total),signal:controller.signal});const body=await response.json();if(!response.ok)throw Error(body.error?.message||'语音识别失败');
  const text=body.data.text;if(!text?.trim())throw Error('没有识别到文字，请重新说一次。');setBusy(false);await send(text);
 }catch(error){if(error.name!=='AbortError'){message(error.message,'error');progress('语音识别未完成。');}}
 finally{recognition=null;setBusy(false);}
}
$('agent-record').onpointerdown=event=>{event.preventDefault();if(busy)return;$('agent-record').setPointerCapture(event.pointerId);void beginRecording();};
$('agent-record').onpointerup=()=>void endRecording(true);$('agent-record').onpointercancel=()=>void endRecording(false);
$('agent-record').onkeydown=event=>{if(['Space','Enter'].includes(event.code)&&!event.repeat){event.preventDefault();void beginRecording();}};
$('agent-record').onkeyup=event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();void endRecording(true);}};
window.addEventListener('pagehide',()=>{closed=true;network?.abort();recognition?.abort();void endRecording(false);stopAudio();player.destroy();for(const href of files)URL.revokeObjectURL(href);});
void boot();
})();
