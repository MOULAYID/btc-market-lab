import asyncio, json, os, re, sqlite3, time, uuid
from collections import defaultdict
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen
import websockets
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from engine import Config, Engine, fixture, run

ROOT=Path(__file__).resolve().parent
BINANCE='wss://stream.binance.com:9443/ws/btcusdt@trade'
POLY='wss://ws-subscriptions-clob.polymarket.com/ws/market'
GAMMA='https://gamma-api.polymarket.com/markets/slug/'
db=sqlite3.connect(os.environ.get('BTC_LAB_DB',str(ROOT/'recordings.sqlite3')))
db.execute('pragma journal_mode=wal')
db.execute('create table if not exists events(session text, seq integer, body text, primary key(session,seq))')
db.commit()
DEMO={'latency':fixture(), 'dense':fixture(50,True), 'threshold':fixture(), 'size':fixture()}

class Live:
    def __init__(self):
        self.id=uuid.uuid4().hex[:12]
        self.start=time.monotonic_ns()
        self.epoch=int(time.time()*1000)
        self.seq=0
        self.engine=Engine(honor_config=True)
        self.events=[]
        self.frames=[]
        self.tasks=[]
        self.tokens={}
        self.status={}
    def now(self): return (time.monotonic_ns()-self.start)//1000000
    def add(self,kind,**kwargs):
        self.seq+=1
        t=self.now()
        e=dict(t=t,seq=self.seq,kind=kind,received_utc=datetime.now(timezone.utc).isoformat(),**kwargs)
        self.engine.ingest(e)
        self.events.append(e)
        db.execute('insert into events values(?,?,?)',(self.id,self.seq,json.dumps(e,separators=(',',':'))))
        return e
    def feed(self,feed,state,detail=''):
        if self.status.get(feed)!=(state,detail):
            self.status[feed]=(state,detail)
            self.add('feed',feed=feed,state=state,detail=detail)
    async def ticker(self):
        while True:
            await asyncio.sleep(.05)
            self.engine.advance(self.now(),False)
            if db.in_transaction: db.commit()
    async def binance(self):
        delay=1
        while True:
            self.feed('Binance','Connecting')
            try:
                async with websockets.connect(BINANCE,ping_interval=None,open_timeout=8) as ws:
                    while True:
                        x=json.loads(await asyncio.wait_for(ws.recv(),15))
                        if x.get('e')!='trade': continue
                        self.feed('Binance','Connected')
                        self.add('trade',price=x['p'],source=x['T'],trade_id=x['t'],size=x['q'])
                        delay=1
            except Exception as e:
                self.feed('Binance','Disconnected',str(e)[:180])
                await asyncio.sleep(delay)
                delay=min(20,delay*2)
    async def poly(self):
        delay=1
        ids=list(self.tokens)
        while ids:
            books={}
            self.feed('Polymarket','Connecting')
            try:
                async with websockets.connect(POLY,ping_interval=None,open_timeout=8) as ws:
                    await ws.send(json.dumps(dict(assets_ids=ids,type='market',custom_feature_enabled=True)))
                    next_ping=time.monotonic()+10
                    last_recv=time.monotonic()
                    while True:
                        now=time.monotonic()
                        if now-last_recv>25: raise TimeoutError('Market heartbeat timed out')
                        if now>=next_ping:
                            await ws.send('PING')
                            next_ping=now+10
                        try: raw=await asyncio.wait_for(ws.recv(),min(1,max(.01,next_ping-now)))
                        except asyncio.TimeoutError: continue
                        last_recv=time.monotonic()
                        if raw=='PONG': continue
                        packet=json.loads(raw)
                        for x in packet if isinstance(packet,list) else [packet]:
                            k=x.get('event_type')
                            ts=int(x['timestamp']) if x.get('timestamp') else None
                            updates=defaultdict(list)
                            if k=='book' and x['asset_id'] in self.tokens:
                                m=x['asset_id']
                                books[m]=({s:{D(a['price']):D(a['size']) for a in x[s] if D(a['size'])>0} for s in ('bids','asks')},ts)
                                updates[m]=[]
                            elif k=='price_change':
                                for a in x['price_changes']:
                                    if a['asset_id'] in books: updates[a['asset_id']].append(a)
                            elif k=='market_resolved':
                                winner=x.get('winning_asset_id')
                                for m in ids:
                                    if x.get('market')==self.tokens[m]['condition'] or m in x.get('assets_ids',[]):
                                        self.add('close',m=m,source=ts,payout=('1' if m==winner else '0') if winner else None)
                            for m,changes in updates.items():
                                b,prev=books[m]
                                if ts is not None and prev is not None and ts<prev: raise ValueError('Out-of-order book timestamp; resync')
                                for a in changes:
                                    side={'BUY':'bids','SELL':'asks'}[a['side']]
                                    p,q=D(a['price']),D(a['size'])
                                    if q>0: b[side][p]=q
                                    else: b[side].pop(p,None)
                                bid=max(b['bids'],default=D(0))
                                ask=min(b['asks'],default=D(1))
                                if bid>=ask or any(p<=0 or p>=1 for s in b.values() for p in s):
                                    raise ValueError('Invalid or crossed book; resync')
                                if changes:
                                    tail=changes[-1]
                                    if any(tail.get(key) is not None and D(tail[key])!=v for key,v in [('best_bid',bid),('best_ask',ask)]):
                                        raise ValueError('Book disagrees with venue top of book; resync')
                                books[m]=(b,ts)
                                self.add('book',m=m,source=ts,**{s:[[str(p),str(q)] for p,q in b[s].items()] for s in b})
                                self.feed('Polymarket','Connected')
                                delay=1
            except asyncio.CancelledError: raise
            except Exception as e:
                self.feed('Polymarket','Disconnected',str(e)[:180])
            finally:
                for m in ids: self.add('invalid',m=m)
            await asyncio.sleep(delay)
            delay=min(20,delay*2)

live=None
@asynccontextmanager
async def lifespan(app):
    yield
    if live:
        for t in live.tasks: t.cancel()
        await asyncio.gather(*live.tasks,return_exceptions=True)
    db.commit()

app=FastAPI(lifespan=lifespan)
class Compare(BaseModel):
    session: str='latency'
    a: Config=Config()
    b: Config=Config(delay=500)
class MarketRequest(BaseModel):
    slug: str
    outcome: int=0

def recording(session):
    if session in DEMO: return DEMO[session],22000
    if live and live.id==session: return live.events[:],live.now()
    events=[json.loads(x[0]) for x in db.execute('select body from events where session=? order by seq',(session,))]
    if not events: raise HTTPException(404,'Recording not found')
    return events,events[-1]['t']

def summary(x):
    return dict(signals=x.signals,orders=x.orders,trace=x.trace,stats=x.stats)

@app.get('/api/sessions')
async def sessions():
    return [r[0] for r in db.execute('select distinct session from events order by rowid desc')]

@app.post('/api/compare')
async def compare(req:Compare):
    e,t=recording(req.session)
    return dict(session=req.session,duration=t,events=e,a=summary(run(e,t,req.a)),b=summary(run(e,t,req.b)))

@app.post('/api/live/start')
async def start():
    global live
    if not live:
        live=Live()
        live.tasks=[asyncio.create_task(live.ticker()),asyncio.create_task(live.binance())]
        live.feed('Polymarket','No market')
    return {'session':live.id}

@app.get('/api/live/state')
async def state(after:int=0):
    if not live: raise HTTPException(409,'Start Live Paper first')
    x=live.engine
    return dict(session=live.id,duration=live.now(),events=live.events[max(0,after):],status=live.status,config=x.cfg.model_dump(),paused=x.paused,
                a=dict(signals=x.signals[-200:],orders=x.orders[-200:],trace=x.trace[-400:],stats=x.stats[-400:]))

@app.post('/api/live/config')
async def config(c:Config):
    if not live: raise HTTPException(409,'Start Live Paper first')
    return live.add('config',config=c.model_dump())

@app.post('/api/live/stop')
async def stop():
    global live
    if not live: raise HTTPException(409,'Start Live Paper first')
    current=live
    for task in current.tasks: task.cancel()
    await asyncio.gather(*current.tasks,return_exceptions=True)
    current.add('end')
    current.engine.advance(current.events[-1]['t'])
    db.commit()
    live=None
    return {'session':current.id}

@app.post('/api/live/pause')
async def pause(paused:bool=True):
    if not live: raise HTTPException(409,'Start Live Paper first')
    return live.add('pause',paused=paused)

@app.post('/api/live/market')
async def market(body:MarketRequest):
    if not live: raise HTTPException(409,'Start Live Paper first')
    slug=body.slug.strip()
    if '://' in slug:
        u=urlparse(slug)
        if u.scheme!='https' or u.hostname not in ('polymarket.com','www.polymarket.com'): raise HTTPException(400,'Use a Polymarket HTTPS URL')
        slug=parse_qs(u.query).get('marketSlug',[u.path.strip('/').split('/')[-1]])[0]
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,200}',slug): raise HTTPException(400,'Invalid market slug')
    def fetch():
        with urlopen(GAMMA+slug,timeout=9) as r: return json.load(r)
    try:
        x=await asyncio.to_thread(fetch)
        arr=lambda v: json.loads(v) if isinstance(v,str) else v
        token=str(arr(x['clobTokenIds'])[body.outcome])
        outcome=arr(x['outcomes'])[body.outcome]
        close=int(datetime.fromisoformat(x['endDate'].replace('Z','+00:00')).timestamp()*1000)-live.epoch
        if body.outcome<0: raise ValueError('Invalid outcome index')
    except Exception as e: raise HTTPException(502,f'Market lookup failed: {e}')
    if token in live.tokens: return {'m':token}
    if len(live.tokens)>=50: raise HTTPException(400,'50 markets maximum')
    if x.get('closed') or x.get('acceptingOrders') is False or close<=live.now():
        raise HTTPException(400,'Market is not accepting orders or has passed its end time')
    meta=dict(name=x['question'],outcome=outcome,slug=slug,condition=x['conditionId'],
              cluster=min(2,max(0,(close-live.now())//86400000)),close=close,
              end=x['endDate'],resolution=x.get('resolutionSource'),strategy=bool(re.search(r'bitcoin|\bbtc\b',x['question'],re.I)))
    if x.get('feesEnabled') is False: meta['fee_rate']='0'
    elif re.fullmatch(r'0x[0-9a-fA-F]{64}',x['conditionId']):
        def fees():
            try:
                with urlopen('https://clob.polymarket.com/clob-markets/'+x['conditionId'],timeout=3) as r:
                    fd=json.load(r).get('fd') or {}
                rate=D(str(fd.get('r')))
                if fd.get('e',1)==1 and 0<=rate<=1: return str(rate)
            except Exception: return None
        rate=await asyncio.to_thread(fees)
        if rate is not None: meta['fee_rate']=rate
    if len(live.tasks)>2:
        live.tasks.pop().cancel()
        await asyncio.sleep(0)
    live.tokens[token]=meta
    live.add('market',m=token,meta=meta)
    live.tasks.append(asyncio.create_task(live.poly()))
    return {'m':token}

app.mount('/',StaticFiles(directory=ROOT/'dist',html=True,check_dir=False),name='ui')
