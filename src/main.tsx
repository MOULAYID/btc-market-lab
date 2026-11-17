import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Network} from './network';
import './style.css';
type Config=typeof defaults;
const defaults={delay:100,threshold:9,size:20,fee:0,window:1000,limit:.56,freshness:2500,cooldown:1800,exposure:250,loss:50,hold:0,partial:true,venue_fee:true};
const money=(n:number,d=2)=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const sec=(t:number)=>(t/1000).toFixed(3)+'s';
type Json=any;
async function api(url:string,body?:Json){const r=await fetch('/api/'+url,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(typeof j.detail==='string'?j.detail:'Settings are outside the permitted range.');return j}
const fixtures=[['latency','Latency race'],['threshold','Signal threshold'],['size','Visible depth'],['dense','50 market stress']];
const fields:[keyof Config,string,string,number][]=[['delay','Order delay','ms',1],['threshold','BTC move','bps',.1],['size','Order size','shares',1],['fee','Fee assumption','bps',1],['window','Lookback','ms',1],['limit','Max entry','$',.01],['freshness','Quote freshness','ms',1],['cooldown','Cooldown','ms',1],['exposure','Exposure cap','$',1],['loss','Session loss','$',1],['hold','Exit after (0 = hold)','ms',1]];
function Spark({values,range,color='#76adff',grid=false}:any){
 const nm=Math.min(...values),mx=Math.max(...values),pad=Math.max((mx-nm)*.18,.00001),lo=range?.[0]??nm-pad,hi=range?.[1]??mx+pad;
 const points=values.map((v:number,i:number)=>[i*280/Math.max(1,values.length-1),54-(v-lo)/(hi-lo)*48]);
 const line=points.map((p:number[])=>p.join(',')).join(' ');
 return <svg viewBox="0 0 280 58" preserveAspectRatio="none" className="spark" aria-hidden="true">
  {grid&&[12,29,46].map(y=><path key={y} d={'M0 '+y+' H280'} stroke="#354461" strokeDasharray="2 5" opacity=".55"/>)}
  {!!line&&<><polygon points={'0,58 '+line+' 280,58'} fill={color} opacity=".08"/><polyline points={line} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke"/></>}
 </svg>
}
function Settings({config,onChange,small=false,other}:any){return <div className={'config '+(small?'small':'')}>{fields.slice(0,small?4:undefined).map(([key,label,unit,step])=><label key={key} className={other&&other[key]!==config[key]?'different':''}>{label}<span><input type="number" aria-label={label} value={config[key]} min={0} step={step} onChange={e=>onChange({...config,[key]:Number(e.target.value)})}/><i>{unit}</i></span></label>)}{!small&&<label className="check"><input type="checkbox" checked={config.partial} onChange={e=>onChange({...config,partial:e.target.checked})}/> Allow partial fills</label>}{!small&&<label className="check"><input type="checkbox" checked={config.venue_fee} onChange={e=>onChange({...config,venue_fee:e.target.checked})}/> Use published venue fees when available</label>}</div>}
function App(){
 const [mode,setMode]=useState('Demo'),[session,setSession]=useState('latency'),[saved,setSaved]=useState<string[]>([]),[data,setData]=useState<Json>(null);
 const [a,setA]=useState(defaults),[b,setB]=useState({...defaults,delay:500}),[speed,setSpeed]=useState(1),[time,setTime]=useState(0),[playing,setPlaying]=useState(true);
 const [selected,select]=useState('m0'),[view,setView]=useState('Network'),[tab,setTab]=useState('Signals'),[query,setQuery]=useState(''),[slug,setSlug]=useState(''),[outcome,setOutcome]=useState(0),[busy,setBusy]=useState(false);
 const [event,setEvent]=useState<Json>(null),[settings,setSettings]=useState(false),[advanced,setAdvanced]=useState(false),[motion,setMotion]=useState(!matchMedia('(prefers-reduced-motion: reduce)').matches),[error,setError]=useState(''),[boundary,setBoundary]=useState(''),[paused,setPaused]=useState(false),[side,setSide]=useState('A');
 const clock=useRef(0), tail=useRef<Json[]>([]), cursor=useRef(0);
 const [cutoff,setCutoff]=useState(Number.POSITIVE_INFINITY);
 const replay=mode==='Replay',live=mode==='Live Paper', synthetic=!live&&fixtures.some(x=>x[0]===session);
 const requestKey=JSON.stringify({session,a,b});
 const analysisReady=live||data?.requestKey===requestKey;
 const seek=(n:number,seq=Number.POSITIVE_INFINITY)=>{clock.current=n;setTime(n);setCutoff(seq)};
 function go(m:string){
  setMode(m);setEvent(null);setError('');setView('Network');setTab(m==='Replay'?'Replay Results':'Signals');
  if(m==='Live Paper') {tail.current=[];cursor.current=0;setData(null);select('');seek(0)}
  else{setSession('latency');select('m0');seek(0);setPlaying(m==='Demo')}
 }
 useEffect(()=>{api('sessions').then(setSaved).catch(()=>{})},[mode]);
 useEffect(()=>{
  if(live){
   let dead=false,timer=0; const poll=async()=>{try{
    const x=await api('live/state?after='+cursor.current);
    if(dead)return;cursor.current=x.events.at(-1)?.seq??cursor.current;
    const fresh=x.events.filter((e:Json)=>e.t>=x.duration-20000);
    const old=tail.current.filter(e=>e.t<x.duration-20000);
    const anchors=new Map();
    for(const e of [...old,...x.events.filter((e:Json)=>e.t<x.duration-20000)]){
      if(['market','book','close','invalid'].includes(e.kind))anchors.set(e.kind==='market'?'meta:'+e.m:'state:'+e.m,e.kind==='invalid'||e.kind==='close'?{...e,prior:anchors.get('state:'+e.m)?.prior||anchors.get('state:'+e.m)}:e);
      else if(e.kind==='trade')anchors.set('btc',e);
    }
    tail.current=[...anchors.values(),...tail.current.filter(e=>e.t>=x.duration-20000),...fresh].sort((a,b)=>a.seq-b.seq);
    setData({...x,events:tail.current.slice()});setPaused(x.paused);seek(x.duration);
   }catch(e){if(!dead)setError(String(e))}if(!dead)timer=window.setTimeout(poll,220)};
   api('live/start',{}).then(()=>{if(!dead)poll()}).catch(e=>!dead&&setError(String(e)));
   return()=>{dead=true;clearTimeout(timer)};
  }
  const ab=new AbortController();
  const timer=setTimeout(async()=>{try{const p=await fetch('/api/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,a,b}),signal:ab.signal});const x=await p.json();if(!p.ok)throw Error(typeof x.detail==='string'?x.detail:'Settings are outside the permitted range.');setData({...x,requestKey});setError('');setEvent(null)}catch(e){if(!ab.signal.aborted)setError(String(e))}},100);
  return()=>{clearTimeout(timer);ab.abort()};
 },[mode,session,a,b]);
 useEffect(()=>{
  if(live||!playing||!data?.duration)return;
  let prev=performance.now();
  const timer=window.setInterval(()=>{
   const now=performance.now(),t=clock.current+(now-prev)*speed;
   prev=now;
   if(t>=data.duration){if(replay){seek(data.duration);setPlaying(false)}else{seek(0);setEvent(null)}}else seek(t)
  },33);
  return()=>clearInterval(timer)
 },[playing,speed,live,replay,data?.duration]);
 const elapsed=Math.floor(time),duration=data?.duration||22000;
 const visible=useMemo(()=>{
  const meta=new Map(), books=new Map(), previousBooks=new Map(), trades=[],recent=[],activity=Array(28).fill(0),quotes=new Map();
  for(const e of data?.events||[]){
   if(e.t>elapsed)break;
   if(e.t===elapsed&&e.seq>cutoff)continue;
   if(e.kind==='market')meta.set(e.m,e.meta);
   if(e.kind==='book'){previousBooks.set(e.m,books.get(e.m));books.set(e.m,e);if(!quotes.has(e.m))quotes.set(e.m,[]);quotes.get(e.m).push(Number(e.asks?.slice().sort((a:any,b:any)=>Number(a[0])-Number(b[0]))[0]?.[0]||0))}
   if(e.kind==='invalid'||e.kind==='close'){if(books.has(e.m)||e.prior?.kind==='book')books.set(e.m,{...(books.get(e.m)||e.prior),invalid:true})}
   if(e.kind==='trade')trades.push(e);
   const i=27-Math.floor((elapsed-e.t)/250);
   if(i>=0&&(e.kind==='book'||e.kind==='trade'))activity[i]++;
   if(elapsed-e.t<=1000)recent.push(e);
  }
  return {meta,books,previousBooks,trades,recent,activity,quotes};
 },[data,elapsed,cutoff]);
 const markets=[...visible.meta.entries()].map(([id,m]:any)=>({id,...m,label:m.name.match(/\$[\d,]+/)?.[0]||['HOUR','WEEK','APR'][m.cluster],stale:!visible.books.has(id)||visible.books.get(id).invalid||elapsed-visible.books.get(id).t>a.freshness||elapsed>=m.close}));
 const target=markets.find(m=>m.id===selected)||markets[0];
 const book=visible.books.get(target?.id), prevBook=visible.previousBooks.get(target?.id);
 const changed=(row:Json,side:string)=>row&&prevBook&&!prevBook[side]?.some((p:Json)=>Number(p[0])===Number(row[0])&&Number(p[1])===Number(row[1]));
 const bids=(book?.bids||[]).slice().sort((a:any,b:any)=>Number(b[0])-Number(a[0])),asks=(book?.asks||[]).slice().sort((a:any,b:any)=>Number(a[0])-Number(b[0]));
 const trade=visible.trades.at(-1),price=trade?.price||0, pct=trade&&visible.trades.length>1?(price/visible.trades[0].price-1)*100:0;
 const stateA=data?.a||{},stateB=data?.b||{};
 const at=(r:Json)=>(r.stats||[]).findLast((s:Json)=>s.t<elapsed||s.t===elapsed&&!Number.isFinite(cutoff))||{cash:1000,positions:[]};
 const st=at(stateA);
 const till=(r:Json)=>({signals:(r.signals||[]).filter((e:Json)=>e.t<elapsed||e.t===elapsed&&e.seq<=cutoff),orders:(r.orders||[]).filter((e:Json)=>e.arrival<elapsed||e.arrival===elapsed&&!Number.isFinite(cutoff))});
 const aa=till(stateA),bb=till(stateB);
 const feed=live?((data?.status?.Binance?.[0]==='Connected'&&trade&&elapsed-trade.t<3000)?'BINANCE LIVE':(data?.status?.Binance?.[0]==='Connected'?'STALE':data?.status?.Binance?.[0]||'CONNECTING')):'SYNTHETIC FEED';
 const diff=useMemo(()=>{
  const as=new Map((stateA.signals||[]).map((s:Json)=>[s.id,s])),bs=new Map((stateB.signals||[]).map((s:Json)=>[s.id,s]));
  const ao=new Map((stateA.orders||[]).map((s:Json)=>[s.id,s])),bo=new Map((stateB.orders||[]).map((s:Json)=>[s.id,s]));
  const ids=[...new Set([...as.keys(),...bs.keys()])];
  return ids.map(id=>({id,a:as.get(id) as Json,b:bs.get(id) as Json,oa:ao.get(id) as Json,ob:bo.get(id) as Json})).sort((x,y)=>(x.a||x.b).t-(y.a||y.b).t).find(x=>x.a?.accepted!==x.b?.accepted||JSON.stringify([x.oa?.outcome,x.oa?.filled,x.oa?.average,x.oa?.fees])!==JSON.stringify([x.ob?.outcome,x.ob?.filled,x.ob?.average,x.ob?.fees]));
 },[data]);
 function jump(){if(!diff)return;setPlaying(false);seek(Math.max(diff.oa?.arrival||0,diff.ob?.arrival||0,(diff.a||diff.b).t));select((diff.a||diff.b).m);setEvent(diff);setTab('Replay Results')}
 const next=()=>{setPlaying(false);const e=(data?.events||[]).find((x:Json)=>x.t>elapsed||x.t===elapsed&&x.seq>cutoff);
  let arr=Infinity;
  for(const r of [stateA,stateB])for(const o of r.orders||[])if(o.arrival>elapsed||o.arrival===elapsed&&Number.isFinite(cutoff))arr=Math.min(arr,o.arrival);
  if(e&&e.t<=arr)seek(e.t,e.seq);else seek(Math.min(arr,duration));
 };
 function chooseSession(id:string){setSession(id);setEvent(null);seek(0);setPlaying(false);select('m0');if(fixtures.some(x=>x[0]===id)){setA(defaults);setB({...defaults,...(id==='threshold'?{threshold:11}:id==='size'?{size:80}:{delay:500})})}}
 async function addMarket(ev:React.FormEvent){ev.preventDefault();setBusy(true);try{const x=await api('live/market',{slug,outcome});select(x.m);setSlug('');setError('');setView('Network')}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function stopLive(){try{const x=await api("live/stop",{});go("Replay");setSession(x.session);setSaved(old=>[...new Set([x.session,...old])])}catch(e){setError(String(e))}}
 async function togglePause(){
  if(!live){if(time>=duration)seek(0);setPlaying(!playing);return}
  try{await api('live/pause?paused='+!paused,{});setPaused(!paused)}catch(e){setError(String(e))}
 }
 function download(){const blob=new Blob([JSON.stringify({session,synthetic,asOf:elapsed,configA:a,configB:b,marketData:data?.events,runA:stateA,runB:stateB},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='btc-market-lab-'+session+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
 const graph=(r:Json,compact=false)=><Network compact={compact} markets={markets} selected={target?.id} onSelect={select} time={elapsed} events={visible.recent} trace={(r.trace||[]).filter((e:Json)=>!Number.isFinite(cutoff)||e.kind==='result'?(!Number.isFinite(cutoff)||e.arrival<elapsed):e.t<elapsed||e.t===elapsed&&e.seq<=cutoff)} motion={motion} running={live||playing}/>;
 const trace=(o:Json,s:Json)=>{const q=o?.quote||s?.quote, bk=o?.book;return <div className="evidence"><b className={o?.outcome==='Missed'?'red':'green'}>{o?.outcome||(!s?'No opportunity':s.accepted?'Pending':'Signal skipped')}</b><p>{o?.reason||s?.reason||'No qualifying upward move for this lookback.'}</p><dl><dt>Signal / event</dt><dd>{s||o?sec((s||o).t)+' · #'+(s||o).seq:'—'}</dd><dt>Order arrival</dt><dd>{o?sec(o.arrival):'—'}</dd><dt>Signal bid / ask × size</dt><dd>{q?(q.bids?.[0]?.[0]||'—')+' / '+(q.asks?.[0]?.join(' × ')||'—'):'—'}</dd><dt>Arrival bid / ask × size</dt><dd>{bk?(bk.bids?.[0]?.[0]||'—')+' / '+(bk.asks?.[0]?.join(' × ')||'—'):'—'}</dd><dt>BTC move</dt><dd>{s?.move!==undefined?money(s.move,2)+" bps":"—"}</dd><dt>Fee model</dt><dd>{o?.fee_model||"—"}</dd><dt>Fill / average / fee</dt><dd>{o?o.filled+' / '+(o.average??'—')+' / $'+money(o.fees,4):'—'}</dd></dl></div>};
 const rows=tab==='Signals'?aa.signals:tab==='Paper Orders'?aa.orders:st.positions||[];
 const spotlight=event?.id&&!event.oa&&!event.ob&&event.m;
 return <>
 <header className="top"><div className="brand"><span className="brandicon">◈</span><div>BTC MARKET LAB<small>RESEARCH TERMINAL</small></div></div>
 <nav aria-label="Data mode">{['Demo','Live Paper','Replay'].map(m=><button key={m} className={m===mode?'selected':''} onClick={()=>go(m)}>{m==='Demo'?'◇ ':m==='Live Paper'?'◉ ':'▷ '}{m}</button>)}</nav>
 <div className="topright"><span className={'badge '+(live&&feed!=='BINANCE LIVE'?'red':'')}><i/>{feed.toUpperCase()}</span><div className="ticker"><small>BTC / USDT</small><b>${money(price)}</b></div><button className="icon" aria-label={live?(paused?'Resume paper entries':'Pause paper entries'):(playing?'Pause':'Play')} title={live?'Pause or resume paper entries':playing?'Pause':'Play'} onClick={togglePause}>{(live?!paused:playing)?'Ⅱ':'▷'}</button><button className="icon" aria-label="Settings" onClick={()=>setSettings(!settings)}>⚙</button></div></header>
 <main>
 <div className="overview"><div><div className="eyebrow"><i/> {live?'PUBLIC MARKET DATA':replay?'RECORDED MARKET DATA':'SYNTHETIC SIMULATION'} <span>/</span> WORKSPACE 01</div><h1>{replay?'A/B Replay':'Market Observatory'}</h1><p>{replay?'One recording. Two configurations. Compare what changed.':'Research BTC price moves and simulated execution across prediction markets.'}</p></div><div className="session"><span className="liveDot"/> {mode.toUpperCase()} <b>{live?(paused?'ENTRIES PAUSED':'PAPER ONLY'):playing?'PLAYING':'PAUSED'}</b><small>{sec(elapsed)}</small></div></div>
 {error&&<div className="notice" role="alert">{error}</div>}
 {settings&&<section className="panel settings"><div className="paneltop"><strong>Strategy & display</strong><button onClick={()=>setSettings(false)}>Close</button></div><label className="check"><input type="checkbox" checked={motion} onChange={e=>setMotion(e.target.checked)}/> Network motion</label><Settings config={a} onChange={setA}/>{live&&<button className="primary" onClick={async()=>{try{const r=await api('live/config',a);setBoundary('Applied at event #'+r.seq+' · '+sec(r.t));setError('')}catch(e){setError(String(e))}}}>Apply to future orders</button>} {boundary&&<small>{boundary}</small>}</section>}
 {replay&&<section className="panel replaycontrols">
  <div className="replaytop"><label>RECORDING <select value={session} onChange={e=>chooseSession(e.target.value)}>{fixtures.map(([id,n])=><option value={id} key={id}>{n} · synthetic</option>)}{saved.map(id=><option key={id} value={id}>Live · {id}</option>)}</select></label><button onClick={()=>setB({...a})}>Copy A → B</button><button onClick={()=>setAdvanced(!advanced)}>Advanced</button><button className="primary" onClick={jump} disabled={!diff||!analysisReady}>↳ First difference</button><button onClick={download} disabled={!analysisReady}>↓ Export JSON</button></div>
  <div className="abconfig">{[['A',a,setA,b],['B',b,setB,a]].map(([key,c,set,o]:any)=><div key={key}><b className={key==='A'?'blue':'gold'}>RUN {key}</b><Settings config={c} onChange={set} small={!advanced} other={o}/></div>)}</div>
 </section>}
 <div className={'workspace '+(replay?'replay':'')}>
 <section className="panel stage">
  <div className="paneltop"><div><span className="blue">⌘</span> <strong>{replay?'Synchronized networks':'Market Network'}</strong><small>{markets.length} WATCHED</small></div><div className="segments">{(replay?['A','B']:['Network','Chart','Markets']).map(v=><button key={v} className={(replay?side:view)===v?'selected':''} onClick={()=>replay?setSide(v):setView(v)}>{v}</button>)}</div></div>
  {live&&<form className="marketform" onSubmit={addMarket}><input placeholder="Polymarket market slug or URL" aria-label="Market slug or URL" value={slug} onChange={e=>setSlug(e.target.value)} required/><select value={outcome} onChange={e=>setOutcome(+e.target.value)} aria-label="Outcome"><option value="0">Outcome 1</option><option value="1">Outcome 2</option></select><button type="submit" disabled={busy}>{busy?'Looking up…':'+ Watch'}</button></form>}
  {replay?<div className={'comparisons show'+side}><div className="runA"><span className="run-tag">● RUN A · {a.delay} ms</span>{graph(stateA,true)}</div><div className="runB"><span className="run-tag gold">● RUN B · {b.delay} ms</span>{graph(stateB,true)}</div></div>:
   view==='Network'?<div className="stagebody"><span className="coordinate">NETWORK TOPOLOGY <br/> BTC REFERENCE / PREDICTION MARKETS</span>{graph(stateA)}<div className="legend"><span><i className="gold"/> Reference hub</span><span><i className="blue"/> Market node</span><span><i className="green"/> Paper fill</span><span><i className="red"/> Miss</span></div><div className="zoom"><button title="Switch to market list" onClick={()=>setView('Markets')}>☷</button><button title="Toggle motion" aria-label="Toggle motion" onClick={()=>setMotion(!motion)}>{motion?'◈':'◇'}</button></div></div>:
   view==='Chart'?<div className="chartview"><span className="eyebrow">REFERENCE PRICE · BTC/USDT</span><h2>${money(price)}</h2><Spark values={visible.trades.slice(-110).map(e=>+e.price)} grid/><p>Most recent 110 trades received</p></div>:
   <div className="marketlist"><input aria-label="Search watched markets" placeholder="Search watched markets…" value={query} onChange={e=>setQuery(e.target.value)}/>{markets.filter(m=>m.name.toLowerCase().includes(query.toLowerCase())).map(m=><button key={m.id} className={target?.id===m.id?'selected':''} onClick={()=>{select(m.id);setView('Network')}}><b>{m.name}</b><span>{m.outcome} · {m.stale?'STALE':'FRESH'} · {live?m.end:'Expiry '+(m.cluster+1)}</span></button>)}</div>}
  <div className="transport"><button aria-label={live?'Pause or resume entries':playing?'Pause playback':'Play playback'} onClick={togglePause}>{(live?!paused:playing)?'Ⅱ':'▷'}</button>{!live&&<><button aria-label="Step one event" onClick={next}>▷│</button><span>{sec(elapsed)}</span><input type="range" aria-label="Shared playhead" min="0" max={duration} step="1" value={Math.floor(time)} onChange={e=>{setPlaying(false);seek(+e.target.value);setEvent(null)}}/><span>{sec(duration)}</span><select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(+e.target.value)}>{[.25,.5,1,2,4].map(s=><option key={s} value={s}>{s}×</option>)}</select>{!replay&&<button onClick={()=>{chooseSession(session==='dense'?'latency':'dense');setPlaying(true)}}>{session==='dense'?'11 markets':'50 markets'}</button>}</>}{live&&<button onClick={stopLive}>Stop &amp; save</button>}{live&&<span>Paper entries {paused?'paused':'enabled'} · {data?.session||'starting'}</span>}</div>
 </section>
 <aside className="telemetry">
 <section className="panel target"><div className="paneltop"><strong><span className="gold">◉</span> Selected market</strong><span className={'tag '+(target?.stale?'red':'green')}>{target?(target.stale?'STALE':'FRESH'):'WAITING'}</span></div>
 <div className="targetbody"><div className="eyebrow">{live?'POLYMARKET':'POLYMARKET FIXTURE'} {target?' / '+target.outcome:''}</div><h2>{target?.name||'Add a market to begin'}</h2><div className="quotes"><div><small>BEST BID</small><b className="green">{bids.length?money(bids[0][0],3):'—'}</b></div><div><small>BEST ASK</small><b className="red">{asks.length?money(asks[0][0],3):'—'}</b></div><div><small>QUOTE AGE</small><b>{book?elapsed-book.t+' ms':'—'}</b></div></div>
 <div className="booktitle"><b>ORDER BOOK</b><span>PRICE / SHARES</span></div>{Array.from({length:3},(_,i)=><div className={'bookrow '+(book&&elapsed-book.t<340&&(changed(bids[i],'bids')||changed(asks[i],'asks'))?'sparkrow':'')} key={i}><span className="green">{bids[i]?money(bids[i][0],3):'—'}</span><span>{bids[i]?.[1]??'—'}</span><span>{asks[i]?.[1]??'—'}</span><span className="red">{asks[i]?money(asks[i][0],3):'—'}</span></div>)}
 {(visible.quotes.get(target?.id)?.length||0)>1&&<div className="quotechart"><span className="axistext">ASK HISTORY · 0–1</span><Spark range={[0,1]} values={visible.quotes.get(target?.id).slice(-60)} color="#c1a3fb" grid/></div>}{live&&<small className="feeds">Polymarket: {data?.status?.Polymarket?.join(' · ')}<br/>Binance: {data?.status?.Binance?.join(' · ')}{trade?.source&&trade.received_utc?<><br/>Binance source → receive: {Date.parse(trade.received_utc)-trade.source} ms (clock dependent)</>:null}{book?.received_utc&&<><br/>Latest book: {book.received_utc}</>}</small>}
 </div></section>
 <section className="panel pricepanel"><div className="paneltop"><strong><span className="blue">⌁</span> BTC / USDT</strong><span className={pct>=0?'green':'red'}>{pct>=0?'+':''}{pct.toFixed(2)}%</span></div><div className="chartbody"><b>${money(price)}</b><Spark values={visible.trades.slice(-85).map(e=>+e.price)} grid/><div className="activity">{visible.activity.map((n,i)=><i key={i} style={{height:Math.min(100,5+n*(session==='dense'?2.8:11))+'%'}}/>)}</div><div className="axistext"><span>RECENT ACTIVITY</span><span>NOW</span></div></div></section>
 <section className="panel account"><div className="paneltop"><strong><span className="violet">◫</span> Paper Session</strong><span className="tag purple">{synthetic?'SYNTHETIC':'PAPER'}</span></div><div className="accountgrid">{[['CASH',st.cash],['EXPOSURE',st.exposure],['REALIZED P&L',st.realized],['EST. UNREALIZED',st.unrealized],['FEES',st.fees],['DRAWDOWN',st.drawdown]].map(([k,v])=><div key={k}><small>{k}</small><b>${money(v)}</b></div>)}</div><div className="positionhint">{st.positions?.length||0} unresolved · {(live?data?.config?.venue_fee:a.venue_fee)&&target?.fee_rate!==undefined?`published taker rate ${target.fee_rate}`:`${(live?data?.config?.fee:a.fee)??0} bps assumed fee`}</div></section>
 </aside></div>
 <section className="panel drawer">
 <div className="drawertop"><div className="tabs">{['Signals','Paper Orders','Positions','Replay Results'].map(k=><button key={k} className={k===tab?'active':''} onClick={()=>{setTab(k);setEvent(null);if(k==='Replay Results'&&!replay)go('Replay')}}>{k}{k==='Signals'&&<em>{aa.signals.filter(s=>s.accepted).length}</em>}{k==='Paper Orders'&&<em>{aa.orders.length}</em>}</button>)}</div><span className="eyebrow">{synthetic?'SYNTHETIC LEDGER':'PAPER LEDGER'}</span></div>
 {replay&&tab==='Replay Results'?<><div className="comparemetrics">{[['Signals',r=>r.signals.filter(s=>s.accepted).length],['Fills',r=>r.orders.filter(o=>o.outcome==='Filled').length],['Partial',r=>r.orders.filter(o=>o.outcome==='Partial').length],['Misses',r=>r.orders.filter(o=>o.outcome==='Missed').length],['Fees',(r,s)=>s.fees||0],['Drawdown',(r,s)=>s.drawdown||0],['Realized P&L',(r,s)=>s.realized||0],['Unresolved',(r,s)=>s.positions?.length||0]].map(([k,fn]:any)=>{const a=fn(aa,st),b=fn(bb,at(stateB));return <div key={k}><small>{k}</small><b>{+a.toFixed(4)} <span>/</span> {+b.toFixed(4)}</b><em>Δ {+(b-a).toFixed(4)}</em></div>})}</div>{event&&(event.a||event.b)&&<div className="diff"><div><strong>Run A</strong>{trace(event.oa,event.a)}</div><div><strong>Run B</strong>{trace(event.ob,event.b)}</div></div>}</>:
 <><div className="tablewrap"><table><thead><tr>{(tab==='Positions'?['MARKET','SHARES','COST BASIS','EST. MARK','STATE']:['EVENT','CLOCK','MARKET','OUTCOME','REASON']).map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.slice(-36).reverse().map((r:Json)=>{const name=visible.meta.get(r.m)?.name||r.m;return <tr key={r.id||r.m} tabIndex={0} className={event?.id===r.id?'rowselected':''} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setEvent(r);select(r.m)}}} onClick={()=>{setEvent(r);select(r.m)}}>
 {tab==='Positions'?<><td>{name}</td><td>{r.qty}</td><td>${money(r.cost)}</td><td>{r.mark_available?'$'+money(r.mark):'No fresh bid'}</td><td>Unresolved</td></>:<><td>#{r.seq}</td><td>{sec(r.arrival??r.t)}</td><td>{name}</td><td className={r.outcome==='Missed'?'red':r.accepted?'gold':r.filled?'green':''}>{r.outcome||(r.accepted?'Signal':'Skipped')}</td><td>{r.reason}</td></>}</tr>})}</tbody></table>{!rows.length&&<p className="empty">{tab==='Signals'?'Waiting for a reference move…':'No '+tab.toLowerCase()+' at this playhead.'}</p>}</div>
 {spotlight&&trace(event.arrival!==undefined?event:aa.orders.find(o=>o.id===event.id),event)}</>}
 </section>
 <footer><span>BTC MARKET LAB / PUBLIC DATA RESEARCH</span><span>{synthetic?'SYNTHETIC DATA & P&L':'SIMULATED EXECUTION'} · NO LIVE ORDERS</span></footer>
 </main></>
}
createRoot(document.getElementById('root')!).render(<App/>);
