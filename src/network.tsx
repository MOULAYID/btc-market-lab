import React,{useEffect,useRef} from 'react';

const TAU=Math.PI*2;
const site=(i:number)=>{
 const predefined=[[.63,.12],[.40,.15],[.70,.26],[.31,.33],[.77,.46],[.24,.58],[.67,.70],[.39,.77],[.48,.92],[.72,.84],[.30,.86]];
 if(i<11)return predefined[i];
 const a=i*2.39996,r=.17+.29*((i*17%47)/47);
 return [.5+Math.cos(a)*r,.5+Math.sin(a)*r*.93];
};
const rand=(n:number)=>{const x=Math.sin(n*79.923+1)*43758.5453;return x-Math.floor(x)};
const pts=Array.from({length:1180},(_,i)=>{
 const a=i*2.399963, z=1-2*(i+.5)/1180,r=Math.sqrt(1-z*z);
 return [r*Math.cos(a),r*Math.sin(a),z,rand(i)];
});
export function Network({markets,selected,onSelect,time,motion,running,events,trace,status,compact=false}:any){
 const canvas=useRef<HTMLCanvasElement>(null), wrap=useRef<HTMLDivElement>(null);
 const props=useRef<any>({}); props.current={markets,selected,time,motion,running,events,trace,status};
 useEffect(()=>{
  const el=canvas.current!, host=wrap.current!, ctx=el.getContext('2d')!;
  let w=1,h=1,raf=0,buffer:HTMLCanvasElement,bc:CanvasRenderingContext2D,last=-1;
  function resize(){
    w=host.clientWidth;h=host.clientHeight;
    const d=Math.min(2,devicePixelRatio);el.width=w*d;el.height=h*d;ctx.setTransform(d,0,0,d,0,0);
    buffer=document.createElement('canvas');buffer.width=w*d;buffer.height=h*d;bc=buffer.getContext('2d')!;bc.setTransform(d,0,0,d,0,0);last=-1;
  }
  const ro=new ResizeObserver(resize);ro.observe(host);resize();
  function plot(ms:number){
   if(w<2||h<2){raf=requestAnimationFrame(plot);return}
   const {markets, selected,time,motion,running,events,trace}=props.current, now=time||0;
   const x=w*.50,y=h*.51, rx=Math.min(w*.39,h*.64),ry=h*.39;
   if(last<0 || (motion&&running&&ms-last>47)){
    last=ms;
    bc.clearRect(0,0,w,h);
    const g=bc.createRadialGradient(x,y,4,x,y,rx*1.25);g.addColorStop(0,'#152238');g.addColorStop(.56,'#101a2f');g.addColorStop(1,'#090e1800');bc.fillStyle=g;bc.fillRect(0,0,w,h);
    const rot=motion?Math.sin(ms*.00016)*.15:0;
    const dots=pts.map(([a,b,c,j])=>[x+(a*Math.cos(rot)+c*Math.sin(rot))*rx,y+(b*.94+c*.16)*ry,c,j]);
    for(let j=0;j<4;j++){
     bc.beginPath();bc.strokeStyle=['#4c6ea92c','#668cc03b','#536eb350','#bddeff57'][j];bc.lineWidth=.55;
     for(let i=j;i<dots.length;i+=4){
      const [sx,sy]=dots[i];
      for(const k of [21,34,55]){
       const [ex,ey]=dots[(i+k)%dots.length];if(Math.hypot(sx-ex,sy-ey)>rx*.19)continue;
       bc.moveTo(sx,sy);bc.lineTo(ex,ey);
      }
     }bc.stroke();
    }
    for(let j=0;j<4;j++){
     bc.beginPath();bc.fillStyle=['#557caf66','#7aabdb8c','#a8d4f4b0','#d9edffeb'][j];
     for(let i=j;i<dots.length;i+=4){const [a,b,c,r]=dots[i];const z=r>.94?1.7:r>.6?.85:.52;bc.moveTo(a+z,b);bc.arc(a,b,z,0,TAU)}bc.fill();
    }
    for(let i=0;i<12;i++){
      const a=(i*19-110)*Math.PI/180;bc.beginPath();bc.ellipse(x,y,rx*(1.02+i*.019),ry*(.43+(i%4)*.11),a,.22,5.7);
      bc.strokeStyle=i===3?'#e5a95457':i%3===0?'#6389cf42':'#5674b333';bc.lineWidth=.65;bc.stroke();
    }
    for(let i=0;i<175;i++){bc.fillStyle=i%23===0?'#dab28570':'#89a9d340';const a=rand(i+2100)*w,b=rand(i+1900)*h;bc.fillRect(a,b,i%23===0?1.7:1,1)}
   }
   ctx.clearRect(0,0,w,h);ctx.drawImage(buffer,0,0,w,h);
   const recent=(trace||[]).filter((e:any)=>Math.abs(now-(e.kind==='result'?e.arrival:e.t))<950||e.kind==='pending'&&now>=e.t&&now<e.arrival);
   const bursts=new Map<string,any>();let btc=false;
   for(const e of (events||[])){const dt=now-e.t;if(dt<0||dt>600)continue;if(e.kind==='trade'&&dt<170)btc=true;if(e.kind==='book')bursts.set(e.m,e)}
   const bright=btc&&motion;
   for(let i=0;i<markets.length;i++){
    const m=markets[i], [u,v]=site(i),xx=u*w,yy=v*h;
    ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo((x+xx)*.5-(yy-y)*.22,(y+yy)*.5+(xx-x)*.21,xx,yy);
    ctx.strokeStyle=m.id===selected?'#eeb85b88':m.stale?'#60708724':'#719ee662';ctx.lineWidth=m.id===selected?1:.6;ctx.stroke();
    const key=recent.findLast((a:any)=>a.m===m.id && (a.kind==='result'?a.arrival:a.t)<=now);
    const signal=recent.findLast((a:any)=>a.m===m.id&&a.kind==='pending'&&a.side==='BUY'&&now>=a.t&&now-a.t<500);
    if(signal&&!m.stale){
     const f=motion?Math.min(1,(now-signal.t)/490):1, g=1-f;
     const cx=(x+xx)*.5-(yy-y)*.22, cy=(y+yy)*.5+(xx-x)*.21;
     ctx.fillStyle='#ffcc7d';ctx.shadowColor='#fabb67';ctx.shadowBlur=motion?16:0;ctx.beginPath();
     ctx.arc(g*g*x+2*f*g*cx+f*f*xx,g*g*y+2*f*g*cy+f*f*yy,3,0,TAU);ctx.fill();ctx.shadowBlur=0;
    }
    if(key&&(!m.stale||key.kind==='result')){
     const t=key.kind==='result'?key.arrival:key.t, f=motion?Math.max(.04,Math.min(1,(now-t)/380)):1;
     const px=x+(xx-x)*f,py=y+(yy-y)*f;
     const color=key.kind==='pending'?'#ffc56e':key.outcome==='Missed'?'#df7f84':'#59e0b4';
     ctx.strokeStyle=color;ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=motion?13:0;
     ctx.beginPath();ctx.arc(xx,yy,key.kind==='pending'?10:13,0,TAU);
     ctx.stroke();ctx.shadowBlur=0;
    }else if(motion&&bursts.has(m.id)&&!m.stale){
      const d=(now-bursts.get(m.id).t)/600;ctx.beginPath();ctx.arc(xx,yy,6+d*14,0,TAU);ctx.strokeStyle='rgba(142,198,255,'+(1-d)*.55+')';ctx.stroke();
    }
   }
   const glow=ctx.createRadialGradient(x,y,1,x,y,bright?72:55);glow.addColorStop(0,'#ffe3a6c9');glow.addColorStop(.25,'#dba75345');glow.addColorStop(1,'#ffc96e00');ctx.fillStyle=glow;ctx.fillRect(x-74,y-74,148,148);
   for(const r of [17,26,36]){ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.strokeStyle=r===17?'#e9b45caa':'#d7aa574d';ctx.lineWidth=.8;ctx.stroke()}
   raf=requestAnimationFrame(plot);
  }
  raf=requestAnimationFrame(plot);
  return()=>{cancelAnimationFrame(raf);ro.disconnect()};
 },[]);
 return <div className={'network '+(compact?'compact':'')} ref={wrap}>
  <canvas ref={canvas} aria-hidden="true"/>
  <div className="axis ax1"/><div className="axis ax2"/>
  <div className="hub"><span>₿</span><small>BTC / USDT</small></div>
  {markets.map((m:any,i:number)=>{const [x,y]=site(i);return <button aria-label={m.name+' '+m.outcome} title={m.name} key={m.id} onClick={()=>onSelect(m.id)} style={{left:x*100+'%',top:y*100+'%'}} className={'node '+(m.id===selected?'active ':'')+(m.stale?'stale':'')}><i/>{!compact&&markets.length<20&&<small>{m.id===selected?'TARGET · ':''}{m.label}</small>}</button>})}
 </div>
}
