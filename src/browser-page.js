/** Static UI only. Model-authored content always enters the DOM as textContent. */
export function browserPage({ token, nonce }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sphinx — understanding check</title>
<style nonce="${nonce}">
:root{color-scheme:light;--ink:#292524;--muted:#625b54;--line:#d8d2c9;--paper:#faf8f5;--amber:#a45009;--focus:#b45309}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 "Avenir Next",Avenir,sans-serif}button,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.55}button:focus-visible,textarea:focus-visible{outline:2px solid var(--focus);outline-offset:3px}header{border-bottom:1px solid var(--line);padding:15px 24px;display:flex;gap:14px;align-items:center;font:15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}header strong{font-size:17px}header span{color:var(--muted)}main{max-width:760px;margin:0 auto;padding:28px 24px 40px}.meta{font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);overflow-wrap:anywhere;margin:0 0 22px}.question{font-size:21px;line-height:1.5;white-space:pre-wrap;margin:12px 0 18px;font-weight:500}.feedback,.error,.message{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 18px}.feedback{border-left:3px solid var(--amber);padding-left:14px}.error{color:#8d271e}.status{color:var(--muted);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}ul{padding-left:22px}label{display:block;margin:20px 0 7px;font-weight:600}textarea{display:block;width:100%;min-height:135px;resize:vertical;padding:12px;border:1px solid #aaa198;border-radius:5px;background:#fff;color:var(--ink)}.hint{font-size:14px;color:var(--muted);margin:8px 0 18px}.actions{display:flex;flex-wrap:wrap;gap:8px}button{border:1px solid #a69b8e;border-radius:5px;padding:8px 14px;background:transparent;color:var(--ink)}button.primary{background:var(--amber);color:#fff;border-color:var(--amber)}button:hover:not(:disabled){background:#eee7dc}button.primary:hover:not(:disabled){background:#8b4208}.pause{margin-left:auto}.secondary-actions{margin-top:18px}.recovery{display:grid;gap:12px}.recovery button{text-align:left;width:100%}.recovery p{margin:0;color:var(--muted);font-size:14px}footer{border-top:1px solid var(--line);padding-top:18px;margin-top:28px;font-size:13px;color:var(--muted)}[hidden]{display:none!important}@media(max-width:500px){main{padding:22px 18px}header{padding:13px 18px}.question{font-size:19px}.pause{margin-left:0}}
</style></head><body>
<header><strong>sphinx</strong><span>Understanding check</span></header>
<main><div id="meta" class="meta"></div><div id="status" class="status" role="status" aria-live="polite">Connecting to your local checkpoint…</div>
<p id="message" class="message" hidden></p><p id="feedback" class="feedback" hidden></p><p id="error" class="error" role="alert" hidden></p>
<section id="question" hidden><p id="prompt" class="question"></p><ul id="choices" hidden></ul>
<form id="form"><label for="response">Your prediction and short reason</label><textarea id="response" maxlength="8000" autocomplete="off" spellcheck="true"></textarea><p class="hint">Open-book: inspect the code whenever useful. Answer in your own words.</p>
<div class="actions"><button class="primary" type="submit">Submit answer</button><button type="button" data-action="learn">Explain this concept</button><button type="button" data-action="dispute">Dispute question</button></div></form></section>
<div id="recovery" class="recovery" hidden></div><div class="actions secondary-actions"><button id="pause" class="pause" type="button">Pause check</button></div>
<footer>Your answers go directly to Sphinx. The coding agent receives status only. <span id="waiting"></span> Use Pause check to stop; closing this tab leaves the operation waiting until its deadline.</footer></main>
<script nonce="${nonce}">
const token=${JSON.stringify(token)},base='/'+token,$=id=>document.getElementById(id);
let current,submitting=false,finished=false,connected=false,lastQuestion;
const text=(id,value)=>{$(id).textContent=value||'';$(id).hidden=!value;};
function render(state){
 if(current&&state.sequence<current.sequence)return;
 current=state;finished=state.operationClosed||['passed','paused','error'].includes(state.phase);
 text('waiting',state.waitingGit?'The original Git operation can continue after the check passes.':'This checkpoint does not replay Git. Return to your coding agent after completion.');
 text('meta',[state.repoRoot,state.target,state.usage?state.usage.calls+'/'+state.usage.limit+' model calls':''].filter(Boolean).join(' · '));
 const label=state.phase==='question'?'Question '+(state.progress.completed+1)+' of '+state.progress.total:state.phase==='working'?'Working…':state.phase==='recovery'?'Review needs your decision':state.phase==='passed'?'Complete':state.phase==='paused'?'Paused':state.phase==='error'?'Check stopped':'Waiting…';
 text('status',label);text('message',state.message);text('feedback',state.feedback);text('error',state.error);
 $('question').hidden=state.phase!=='question';$('recovery').hidden=state.phase!=='recovery';$('pause').hidden=finished;
 if(state.phase==='question'){
  text('prompt',state.question.prompt);$('choices').replaceChildren();
  for(const choice of state.question.choices||[]){const li=document.createElement('li');li.textContent=choice;$('choices').append(li);}
  $('choices').hidden=!(state.question.choices||[]).length;
  if(lastQuestion!==state.id+state.question.id){$('response').value='';lastQuestion=state.id+state.question.id;}
 }
 $('recovery').replaceChildren();
 if(state.phase==='recovery')for(const choice of state.choices||[]){
  if(choice.value==='pause')continue;
  const row=document.createElement('div'),button=document.createElement('button'),description=document.createElement('p');
  button.type='button';button.textContent=choice.label;button.onclick=()=>send(choice.value);description.textContent=choice.description;row.append(button,description);$('recovery').append(row);
 }
 for(const button of document.querySelectorAll('button'))button.disabled=submitting||!connected||state.operationClosed;
}
async function send(action){
 if(!current||submitting||finished||!connected)return;
 const response=$('response').value.trim();
 if(['answer','dispute'].includes(action)&&!response){text('error',action==='dispute'?'Explain what is ambiguous or unsupported in the answer box.':'Enter your prediction and a short reason.');$('response').focus();return;}
 submitting=true;render(current);
 try{
  const res=await fetch(base+'/action',{method:'POST',headers:{'Content-Type':'application/json','X-Sphinx-Token':token},body:JSON.stringify({id:current.id,revision:current.revision,action,...(['answer','learn','dispute'].includes(action)?{questionId:current.question.id,response}:{})})});
  const data=await res.json();if(!res.ok){text('error',data.error||'This response could not be submitted.');return;}render(data);
 }catch{if(!finished)text('error','The local questionnaire disconnected. Check the original Git output; no response is retried automatically.');}
 finally{submitting=false;if(current)for(const button of document.querySelectorAll('button'))button.disabled=!connected||current.operationClosed;}
}
$('form').onsubmit=event=>{event.preventDefault();send('answer');};
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>send(button.dataset.action);
$('pause').onclick=()=>send('pause');
const events=new EventSource(base+'/events');events.onmessage=event=>{try{connected=true;render(JSON.parse(event.data));if(current?.operationClosed){connected=false;events.close();}}catch{}};
events.onerror=()=>{connected=false;for(const button of document.querySelectorAll('button'))button.disabled=true;if(current?.operationClosed){events.close();return;}text('error','Connection interrupted. Reconnecting to the local questionnaire… If Git has stopped, check its output. No response is retried automatically.');};
</script></body></html>`;
}
