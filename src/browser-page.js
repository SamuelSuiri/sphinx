/** Static UI only. Model-authored content always enters the DOM as textContent. */
export function browserPage({ token, nonce }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sphinx — understanding check</title>
<style nonce="${nonce}">
:root{color-scheme:light;--ink:#292524;--muted:#6b6259;--line:#dfd8cf;--paper:#faf8f5;--amber:#a45009;--focus:#b45309}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 "Avenir Next",Avenir,sans-serif}
button,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
.shell{height:100vh;height:100dvh;display:flex;flex-direction:column}
header{min-height:60px;border-bottom:1px solid var(--line);padding:12px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:baseline;gap:14px}.brand strong{font:600 19px ui-monospace,SFMono-Regular,Menlo,monospace}.brand span{color:var(--muted);font-size:14px}
main{width:100%;max-width:800px;margin:0 auto;padding:0 24px;display:flex;flex:1;flex-direction:column;min-height:0}
.context{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}
#meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#usage{white-space:nowrap;font-variant-numeric:tabular-nums}
.conversation{flex:1;min-height:0;overflow-y:auto;padding:24px 8px 8px 0;scrollbar-width:thin}
#messages{list-style:none;margin:0;padding:0}.turn{margin:0 0 24px}.turn.human{margin-left:32px;padding:12px 16px;background:#f0ebe4;border-left:2px solid #c6b7a5}
.speaker{font-size:13px;font-weight:600;margin-bottom:6px}.turn-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.turn.question .turn-text{font-size:18px;line-height:1.6;font-weight:500}
.turn-note{font-size:12px;color:var(--muted);margin-top:6px}.turn.notice{color:var(--muted)}.question-number{font-size:13px;color:var(--muted);margin-bottom:6px}
.question{font-size:18px;line-height:1.6;white-space:pre-wrap;margin:8px 0 20px;font-weight:500}.feedback,.message{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 20px}
ul{padding-left:22px}.status{font-size:13px;color:var(--muted);margin:0 0 12px}
.composer{flex-shrink:0;border-top:1px solid var(--line);padding:16px 0 12px}.error{font-size:14px;color:#8d271e;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px}
label{display:block;font-size:14px;font-weight:600;margin-bottom:8px}
textarea{display:block;width:100%;min-height:76px;max-height:180px;resize:vertical;padding:12px 14px;border:1px solid #b9afa3;border-radius:6px;background:#fff;color:var(--ink);line-height:1.5}
textarea:disabled{background:#f6f2ed;color:var(--muted)}textarea::placeholder{color:#82796f}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
button{border:1px solid #c3b8aa;border-radius:6px;padding:7px 12px;background:transparent;color:var(--ink);font-size:14px;line-height:1.5}
button.primary{background:var(--amber);color:#fff;border-color:var(--amber);margin-left:auto;min-width:72px}
button:hover:not(:disabled){background:#eee7dc}button.primary:hover:not(:disabled){background:#8b4208}
button.quiet{border-color:transparent;color:var(--muted)}button.quiet:hover:not(:disabled){color:var(--ink)}
.hint{font-size:12px;color:var(--muted);margin:10px 0 0}.recovery{display:grid;gap:12px;margin:0 0 20px}.recovery button{text-align:left;width:100%}.recovery p{margin:4px 0 0;font-size:13px;color:var(--muted)}
header .tools{display:flex;gap:4px}
.skipbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}.skipbar p{flex-basis:100%;margin:0;color:var(--muted);font-size:13px}
.skipbar input{flex:1;min-width:180px;font:inherit;font-size:14px;padding:6px 10px;border:1px solid #b9afa3;border-radius:6px;background:#fff;color:var(--ink)}
button.danger{background:#8d271e;border-color:#8d271e;color:#fff}button.danger:hover:not(:disabled){background:#6f1f18}
.turn.activity{margin:0 0 6px;font-size:13px;color:var(--muted)}.turn.activity .speaker{display:none}.turn.activity .turn-text::before{content:"✓ ";color:#7c8a5c}
.turn.activity.live .turn-text::before{content:"● ";color:var(--amber);animation:pulse 1.2s ease-in-out infinite}.turn.activity+.turn:not(.activity){margin-top:18px}
.status.busy::before{content:"● ";color:var(--amber);animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.25}}
@media(prefers-reduced-motion:reduce){.status.busy::before,.turn.activity.live .turn-text::before{animation:none}}
footer{flex-shrink:0;padding:0 0 14px;color:var(--muted);font-size:12px;line-height:1.5}footer p{margin:0}#waiting{margin-top:3px}[hidden]{display:none!important}
@media(max-width:600px){header{padding:12px 16px}.brand{gap:8px}.brand span{display:none}main{padding:0 16px}.context{align-items:flex-start;flex-direction:column;gap:4px}.conversation{padding-top:20px}.turn.human{margin-left:16px}.actions{gap:4px}button{padding:7px 10px}.hint{max-width:34em}}
</style></head><body><div class="shell">
<header><div class="brand"><strong>sphinx</strong><span>Understanding check</span></div><div class="tools"><button id="skip" class="quiet" type="button">Skip this time</button><button id="pause" class="quiet" type="button">Pause check</button></div></header>
<main><div class="context"><span id="meta"></span><span id="usage"></span></div>
<div id="skipbar" class="skipbar" hidden><input id="skipreason" maxlength="500" autocomplete="off" placeholder="Why is this urgent? (optional)" aria-label="Reason for skipping"><button id="skipconfirm" class="danger" type="button">Skip and continue</button><button id="skipcancel" class="quiet" type="button">Cancel</button><p>The push goes through without the check. The skip is logged and the check stays pending for later.</p></div>
<div id="conversation" class="conversation" aria-label="Understanding check conversation">
<ol id="messages" aria-label="Conversation"></ol>
<p id="feedback" class="feedback" hidden></p><section id="question" hidden><p id="prompt" class="question"></p><ul id="choices" hidden></ul></section>
<p id="message" class="message" hidden></p><div id="status" class="status" role="status" aria-live="polite">Connecting to your local checkpoint…</div><div id="recovery" class="recovery" hidden></div>
</div>
<div id="composer" class="composer"><p id="error" class="error" role="alert" hidden></p>
<form id="form"><label for="response">Your answer</label><textarea id="response" rows="2" maxlength="8000" autocomplete="off" spellcheck="true" placeholder="Your prediction and a short reason…"></textarea>
<div class="actions"><button type="button" class="quiet" data-action="learn">Explain this</button><button type="button" class="quiet" data-action="dispute">Dispute question</button><button id="submit" class="primary" type="submit">Send</button></div>
<p class="hint">Enter to send · Shift+Enter for a new line. Open-book—inspect the code whenever useful.</p></form></div>
<footer><p>Your answers go directly to Sphinx. The coding agent receives status only.</p><p id="waiting">Closing this tab leaves the check waiting. Use Pause check to stop.</p></footer>
</main></div>
<script nonce="${nonce}">
const token=${JSON.stringify(token)},base='/'+token,$=id=>document.getElementById(id);
let current,submitting=false,finished=false,connected=false,lastQuestion,lastGraded,lastMessages='';
const text=(id,value)=>{$(id).textContent=value||'';$(id).hidden=!value;};
const resize=()=>{$('response').style.height='auto';$('response').style.height=Math.min($('response').scrollHeight||76,180)+'px';};
function controls(){
 if(!current)return;
 const canAnswer=current.phase==='question'&&!current.operationClosed&&connected&&!submitting;
 for(const button of document.querySelectorAll('button'))button.disabled=!canAnswer;
 $('pause').disabled=!connected||submitting||finished;
 for(const id of ['skip','skipconfirm','skipcancel'])$(id).disabled=!connected||finished;
 for(const button of $('recovery').querySelectorAll('button'))button.disabled=!connected||submitting||finished;
 $('response').disabled=current.phase!=='question'||current.operationClosed||submitting;
}
function history(messages){
 const signature=JSON.stringify([current?.phase,messages]);
 if(signature===lastMessages)return;
 lastMessages=signature;
 const scroll=$('conversation'),nearBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<100;
 $('messages').replaceChildren();
 for(const item of messages){
  const row=document.createElement('li'),name=document.createElement('div'),body=document.createElement('p');
  const live=item.kind==='activity'&&item===messages.at(-1)&&current?.phase==='working';
  row.className='turn '+(item.role==='human'?'human':'sphinx')+(item.kind==='question'?' question':item.kind==='notice'?' notice':item.kind==='activity'?' activity'+(live?' live':''):'');
  name.className='speaker';name.textContent=item.role==='human'?'You':'Sphinx';body.className='turn-text';body.textContent=item.text;
  row.append(name);
  if(item.kind==='question'&&item.number){const caption=document.createElement('div');caption.className='question-number';caption.textContent='Question '+item.number+(item.followUp?' · Follow-up':'');row.append(caption);}
  row.append(body);
  if(item.choices?.length){const list=document.createElement('ul');for(const choice of item.choices){const li=document.createElement('li');li.textContent=choice;list.append(li);}row.append(list);}
  if(item.role==='human'&&['checking','not-graded'].includes(item.status)){const note=document.createElement('div');note.className='turn-note';note.textContent=item.status==='checking'?'Checking your reasoning…':'Not assessed. Your draft is still available below.';row.append(note);}
  $('messages').append(row);
 }
 if(nearBottom)scroll.scrollTop=scroll.scrollHeight;
}
function render(state){
 if(current&&state.sequence<current.sequence)return;
 const previous=current;current=state;finished=state.operationClosed||['passed','paused','error','skipped'].includes(state.phase);
 const repo=state.repoRoot?.split(/[\\\\/]/).filter(Boolean).at(-1),branch=state.target?.replace(/^refs\\/heads\\//,'');
 text('meta',[repo,branch].filter(Boolean).join(' / '));$('meta').title=state.repoRoot||'';
 text('usage',state.usage?(state.usage.limit==null?state.usage.calls+' model calls · no limit':state.usage.calls+' / '+state.usage.limit+' model calls'):'');
 text('waiting',state.waitingGit?'Git continues after you pass. Closing this tab leaves it waiting; Pause check stops it.':'Closing this tab leaves the check waiting. Use Pause check to stop.');
 const label=state.phase==='question'?'Question '+(state.progress.completed+1)+' of '+state.progress.total:state.phase==='working'?'Working…':state.phase==='recovery'?'Review needs your decision':state.phase==='passed'?'Complete':state.phase==='paused'?'Paused':state.phase==='skipped'?'Skipped':state.phase==='error'?'Check stopped':'Waiting…';
 text('status',label);$('status').className='status'+(state.phase==='working'?' busy':'');text('message',state.message);text('error',state.error);
 const messages=state.messages||[];history(messages);
 // Live activity already shows progress; avoid stacking generic spinners under it.
 if(state.phase==='working'&&messages.at(-1)?.kind==='activity'){$('status').hidden=true;$('message').hidden=true;}
 text('feedback',messages.length?'':state.feedback);
 $('question').hidden=state.phase!=='question'||messages.some(item=>item.kind==='question'&&item.questionId===state.question?.id);
 $('composer').hidden=!['question','working'].includes(state.phase)&&!state.error;
 $('form').hidden=!['question','working'].includes(state.phase);
 $('recovery').hidden=state.phase!=='recovery';$('pause').hidden=finished;$('skip').hidden=finished;if(finished)$('skipbar').hidden=true;
 if(state.question){
  text('prompt',state.question.prompt);$('choices').replaceChildren();
  for(const choice of state.question.choices||[]){const li=document.createElement('li');li.textContent=choice;$('choices').append(li);}
  $('choices').hidden=!(state.question.choices||[]).length;
  const key=state.id+':'+state.question.id;
  if(lastQuestion!==key){$('response').value='';lastQuestion=key;resize();}
 }
 const graded=[...messages].reverse().find(item=>item.role==='human'&&item.status==='graded');
 if(graded&&lastGraded!==graded.id){lastGraded=graded.id;$('response').value='';resize();}
 $('recovery').replaceChildren();
 if(state.phase==='recovery')for(const choice of state.choices||[]){
  if(choice.value==='pause')continue;
  const row=document.createElement('div'),button=document.createElement('button'),description=document.createElement('p');
  button.type='button';button.textContent=choice.label;button.onclick=()=>send(choice.value);description.textContent=choice.description;row.append(button,description);$('recovery').append(row);
 }
 controls();
 if(state.phase==='question'&&(previous?.phase!=='question'||previous?.question?.id!==state.question?.id)&&document.visibilityState!=='hidden')$('response').focus({preventScroll:true});
}
async function send(action){
 if(!current||submitting||finished||!connected)return;
 if(['answer','learn','dispute'].includes(action)&&current.phase!=='question')return;
 const response=$('response').value.trim();
 if(['answer','dispute'].includes(action)&&!response){text('error',action==='dispute'?'Describe what is ambiguous or unsupported in the answer box.':'Enter your prediction and a short reason.');$('response').focus();return;}
 submitting=true;controls();
 try{
  const res=await fetch(base+'/action',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:JSON.stringify({id:current.id,revision:current.revision,action,...(['answer','learn','dispute'].includes(action)?{questionId:current.question.id,response}:action==='skip'&&$('skipreason').value.trim()?{response:$('skipreason').value.trim()}:{})})});
  const data=await res.json();if(!res.ok){text('error',data.error||'This response could not be submitted.');return;}render(data);
 }catch{if(!finished)text('error','Connection interrupted. Your response is not resent automatically. Wait for the current state before trying again.');}
 finally{submitting=false;controls();}
}
$('form').onsubmit=event=>{event.preventDefault();send('answer');};
$('response').oninput=resize;
$('response').onkeydown=event=>{
 if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229)return;
 event.preventDefault();if(!event.repeat)send('answer');
};
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>send(button.dataset.action);
$('pause').onclick=()=>send('pause');
$('skip').onclick=()=>{$('skipbar').hidden=false;$('skipreason').focus();};
$('skipcancel').onclick=()=>{$('skipbar').hidden=true;};
$('skipconfirm').onclick=()=>send('skip');
$('skipreason').onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();send('skip');}else if(event.key==='Escape')$('skipbar').hidden=true;};
const events=new EventSource(base+'/events');events.onmessage=event=>{try{connected=true;render(JSON.parse(event.data));if(current?.operationClosed){connected=false;events.close();}}catch{}};
events.onerror=()=>{connected=false;controls();if(current?.operationClosed){events.close();return;}text('error','Connection interrupted. Reconnecting… No response is retried automatically. If Git has stopped, check its output.');};
</script></body></html>`;
}
