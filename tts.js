/* Arabic read-aloud for Prayer Booklet. Drop-in, no dependencies (Web Speech API).
   Adds: a play/pause button in the top bar, a "Listen to all" button on the cover,
   and Voice / Speed / Auto-continue rows in the Aa menu. */
(function(){
"use strict";
var ss=window.speechSynthesis;
if(!ss||typeof SpeechSynthesisUtterance==="undefined")return;
var P=document.getElementById("pager"),bar=document.querySelector(".top"),pop=document.getElementById("pop"),
num=document.getElementById("num"),cover=document.getElementById("s0"),app=document.querySelector(".app");
if(!P||!bar||!pop||!app)return;

var N=P.querySelectorAll(".page").length,RATES=[.6,.7,.8,.9,1],MAX=220,
NOVOICE="No Arabic voice found on this device. Install one in your system’s text-to-speech settings.";
function get(k){try{return localStorage.getItem(k)}catch(e){return null}}
function put(k,v){try{localStorage.setItem(k,v)}catch(e){}}
var rate=parseFloat(get("pb-rate"))||.8,vuri=get("pb-voice")||"",chain=get("pb-chain")!=="0",
state="idle",tok=0,spage=0,queue=[],qi=0,autoTo=-1,forceAll=false,hl=null,keep=null,mt;

/* ---------- UI ---------- */
var css=document.createElement("style");
css.textContent=
"[hidden]{display:none!important}"+
"#sp{flex:none;width:36px;height:32px;padding:0;display:grid;place-items:center;border-radius:12px;background:var(--card);color:var(--accent)}"+
"#sp[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--bg)}"+
".top .n{width:44px}"+
"#vc{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"+
"#vc:disabled{opacity:.55;cursor:default}"+
".row label{min-width:0}"+
".listen{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:10px 22px;font-size:19px;background:var(--accent);border-color:var(--accent);color:var(--bg)}"+
".ayah.say{border-color:var(--brass);background:linear-gradient(var(--glow),var(--glow)),var(--card);box-shadow:0 0 0 2px var(--brass),0 14px 30px -22px rgba(0,0,0,.45)}"+
"#tmsg{position:absolute;z-index:30;left:16px;right:16px;bottom:84px;margin:0 auto;max-width:420px;padding:10px 14px;border:1px solid var(--line);border-radius:16px;background:var(--card);color:var(--ink);font-size:16px;line-height:1.5;text-align:center;box-shadow:0 12px 32px rgba(0,0,0,.2)}";
document.head.appendChild(css);

function mk(h){var d=document.createElement("div");d.innerHTML=h;return d.firstChild}
var ICON={
 play:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
 pause:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'};

var sp=mk('<button id="sp" aria-label="Listen" aria-pressed="false"></button>');
bar.insertBefore(sp,num);
pop.appendChild(mk('<div class="row"><label>Voice</label><button id="vc">Auto</button></div>'));
pop.appendChild(mk('<div class="row"><label>Speed</label><button id="sd"></button></div>'));
pop.appendChild(mk('<div class="row"><label>Auto-continue</label><button id="ch"></button></div>'));
var la=mk('<button class="listen" id="la">'+ICON.play+'Listen to all</button>');
if(cover)cover.insertBefore(la,cover.querySelector(".hint"));
var msg=mk('<div id="tmsg" role="status" hidden></div>');
app.appendChild(msg);
var vc=document.getElementById("vc"),sd=document.getElementById("sd"),ch=document.getElementById("ch");

/* ---------- voices ---------- */
function sc(v){return(/^ar[-_]SA$/i.test(v.lang)?2:0)+(v.localService?1:0)}
function arV(){var a=[],l=ss.getVoices()||[];
 for(var i=0;i<l.length;i++)if(/^ar([-_]|$)/i.test(l[i].lang))a.push(l[i]);
 return a.sort(function(x,y){return sc(y)-sc(x)})}
function pick(){var a=arV();for(var i=0;i<a.length;i++)if(a[i].voiceURI===vuri)return a[i];return a[0]||null}
function ui(){
 var a=arV(),v=pick(),on=state==="play";
 sp.innerHTML=on?ICON.pause:ICON.play;
 sp.setAttribute("aria-pressed",String(on));
 sp.setAttribute("aria-label",on?"Pause":"Listen");
 vc.textContent=v?v.name.replace(/^(Microsoft|Google)\s+/,""):"Auto";
 vc.disabled=a.length<2;
 sd.textContent=rate+"×";
 ch.textContent=chain?"On":"Off";
 ch.setAttribute("aria-pressed",String(chain));
}
ss.onvoiceschanged=ui;

/* ---------- text prep ---------- */
/* Split at waqf marks and Arabic punctuation, then merge into chunks of up to MAX
   characters. Short chunks give natural pauses and avoid the ~15 s cut-off that some
   engines (notably Chrome network voices) apply to long utterances. */
function split(t){
 var out=[],b="";
 t.split(/[\u06D6-\u06DC\u060C\u061B\u061F.]/).forEach(function(s){
  s=s.replace(/[\u06DD\u06DE\u06E9]/g,"").replace(/\s+/g," ").trim();
  if(!s)return;
  if(b&&b.length+s.length>MAX){out.push(b);b=s}else b=b?b+"، "+s:s;
 });
 if(b)out.push(b);
 return out;
}
function build(pi){
 var out=[],pg=P.querySelectorAll(".page")[pi];
 if(!pg)return out;
 [].forEach.call(pg.querySelectorAll(".ayah"),function(el){
  var a=el.querySelector(".ar");if(!a)return;
  var c=a.cloneNode(true);
  [].forEach.call(c.querySelectorAll("b"),function(b){b.parentNode.removeChild(b)}); /* drop ﴿٢٨٤﴾ */
  split(c.textContent).forEach(function(t){out.push({t:t,el:el})});
 });
 return out;
}

/* ---------- highlight / navigation ---------- */
function mark(el){
 if(hl===el)return;
 unmark();hl=el;el.classList.add("say");
 var pg=el.closest(".page"),pr=pg.getBoundingClientRect(),er=el.getBoundingClientRect(),
 off=er.height<pr.height?(pr.height-er.height)/2:12;
 pg.scrollTo({top:pg.scrollTop+er.top-pr.top-off,behavior:"smooth"});
}
function unmark(){if(hl){hl.classList.remove("say");hl=null}}
function curPage(){return Math.round(P.scrollLeft/P.clientWidth)}
function nav(i){
 if(curPage()===i)return;
 autoTo=i;
 P.scrollTo({left:i*P.clientWidth,behavior:"smooth"});
 setTimeout(function(){autoTo=-1},1500);
}
/* If the reader swipes to another page, stop (our own page turns are ignored). */
P.addEventListener("scroll",function(){
 if(state==="idle")return;
 var c=curPage();
 if(autoTo>=0){if(c===autoTo)autoTo=-1;return}
 if(c!==spage)stop();
});

/* ---------- playback ---------- */
function say(t){msg.textContent=t;msg.hidden=false;clearTimeout(mt);mt=setTimeout(function(){msg.hidden=true},7000)}
function speak(my){
 if(my!==tok)return;
 if(qi>=queue.length){
  if((chain||forceAll)&&spage<N-1){
   spage++;queue=build(spage);qi=0;nav(spage);
   setTimeout(function(){speak(my)},800); /* let the page turn finish */
   return;
  }
  stop();return;
 }
 var it=queue[qi],u=new SpeechSynthesisUtterance(it.t),v=pick(),t0;
 if(v){u.voice=v;u.lang=v.lang}else u.lang="ar-SA";
 u.rate=rate;
 u.onend=function(){
  if(my!==tok)return;
  if(Date.now()-t0<150&&it.t.length>8){stop();say(NOVOICE);return} /* nothing was actually spoken */
  qi++;speak(my);
 };
 u.onerror=function(e){
  if(my!==tok||(e&&(e.error==="interrupted"||e.error==="canceled")))return;
  stop();say(NOVOICE);
 };
 mark(it.el);
 keep=u; /* hold a reference so the engine can't garbage-collect the utterance */
 t0=Date.now();
 ss.speak(u);
}
function start(pi,all){
 unmark();
 var l=ss.getVoices();
 if(l&&l.length&&!arV().length)say(NOVOICE);
 var my=++tok;
 spage=pi;queue=build(pi);qi=0;forceAll=!!all;state="play";
 nav(pi);ui();
 if(ss.speaking||ss.pending){ss.cancel();setTimeout(function(){speak(my)},100)}
 else speak(my); /* called synchronously so iOS accepts it as part of the tap */
}
function pause(){tok++;ss.cancel();state="paused";ui()} /* cancel+resume-from-chunk: pause() is unreliable on Android */
function resume(){state="play";var my=++tok;ui();speak(my)}
function stop(){tok++;ss.cancel();state="idle";unmark();ui()}
function toggle(){
 var c=curPage();
 if(state==="play"){pause();return}
 if(state==="paused"&&c===spage){resume();return}
 start(c||1,!c); /* on the cover, read everything */
}

/* ---------- wiring ---------- */
sp.onclick=toggle;
la.onclick=function(){start(1,true)};
vc.onclick=function(){
 var a=arV(),i=a.indexOf(pick()),v=a[(i+1)%a.length];
 if(v){vuri=v.voiceURI;put("pb-voice",vuri)}
 ui();
};
sd.onclick=function(){rate=RATES[(RATES.indexOf(rate)+1)%RATES.length];put("pb-rate",String(rate));ui()};
ch.onclick=function(){chain=!chain;put("pb-chain",chain?"1":"0");ui()};
window.addEventListener("pagehide",function(){ss.cancel()});
ui();
})();
