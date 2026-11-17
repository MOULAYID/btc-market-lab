from decimal import Decimal as D
from collections import deque
from heapq import heappop, heappush
from math import sin
from pydantic import BaseModel, Field

class Config(BaseModel):
    delay: int = Field(100, ge=0, le=30000)
    threshold: float = Field(9, gt=0, le=10000)
    window: int = Field(1000, ge=1, le=60000)
    size: float = Field(20, gt=0, le=100000)
    limit: float = Field(.56, gt=0, le=1)
    freshness: int = Field(2500, ge=1, le=120000)
    cooldown: int = Field(1800, ge=0, le=600000)
    exposure: float = Field(250, gt=0, le=1000)
    loss: float = Field(50, gt=0, le=1000)
    fee: float = Field(0, ge=0, le=10000)
    venue_fee: bool = True
    hold: int = Field(0, ge=0, le=3600000)
    partial: bool = True

def d(x): return D(str(x))
def num(x): return float(x)
def levels(book, side):
    return [[str(p), str(q)] for p,q in sorted(book[side].items(), reverse=side=='bids') if q>0]

class Engine:
    def __init__(self, config=None, honor_config=False):
        self.cfg=config or Config()
        self.honor=honor_config
        self.clock=0
        self.books={}
        self.markets={}
        self.pending=[]
        self.signals=[]
        self.orders=[]
        self.trace=[]
        self.trades=deque()
        self.last={}
        self.positions={}
        self.cash=D(1000)
        self.fees=self.realized=self.drawdown=D(0)
        self.peak=self.cash
        self.paused=False
        self.serial=0
        self.price=None
        self.stats=[]
        self.metric_tick=-250

    def quote(self,m,t):
        b=self.books.get(m)
        if not b: return None
        return dict(t=b['t'],age=t-b['t'],seq=b['seq'],valid=b['valid'],
                    bids=levels(b,'bids')[:8],asks=levels(b,'asks')[:8])

    def metrics(self):
        marked=cost=D(0)
        rows=[]
        for m,(qty,basis) in self.positions.items():
            if not qty: continue
            b=self.books.get(m)
            bid=max(b['bids'],default=D(0)) if b and b['valid'] and self.clock-b['t']<=self.cfg.freshness else D(0)
            mark=bid*qty if bid else basis
            marked+=mark
            cost+=basis
            rows.append(dict(m=m,qty=num(qty),cost=num(basis),mark=num(mark),mark_available=bool(bid),state='Unresolved'))
        return dict(cash=num(self.cash),exposure=num(cost),fees=num(self.fees),realized=num(self.realized),
                    unrealized=num(marked-cost),equity=num(self.cash+marked),drawdown=num(self.drawdown),positions=rows)

    def sample(self, force=False):
        if not force and self.clock-self.metric_tick<250: return
        s=self.metrics()
        equity=d(s['equity'])
        self.peak=max(self.peak,equity)
        self.drawdown=max(self.drawdown,self.peak-equity)
        self.metric_tick=self.clock
        self.stats.append({**s,'t':self.clock,'drawdown':num(self.drawdown)})

    def schedule(self,t,m,seq,cfg,quote,side,qty):
        self.serial+=1
        order=dict(id=f'{seq}:{m}:{side}',m=m,seq=seq,t=t,arrival=t+cfg.delay,
                   quote=quote,side=side,requested=str(qty),config=cfg.model_dump())
        heappush(self.pending,(order['arrival'],self.serial,order))
        self.trace.append(dict(**order,kind='pending'))

    def advance(self,t,inclusive=True):
        while self.pending and (self.pending[0][0]<t or inclusive and self.pending[0][0]==t):
            at,_,o=heappop(self.pending)
            self.clock=at
            self.execute(o)
            self.sample(True)
        self.clock=t
        if inclusive: self.sample()

    def execute(self,o):
        m,t=o['m'],o['arrival']
        c=Config(**o['config'])
        b=self.books.get(m)
        side=o['side']
        buy=side=='BUY'
        qty,basis=self.positions.get(m,(D(0),D(0)))
        need=d(o['requested'])
        bookside='asks' if buy else 'bids'
        fills=[]
        notional=filled=fee=D(0)
        reason=''
        meta=self.markets[m]
        q=self.quote(m,t)
        if meta.get('closed') or t>=meta.get('close',float('inf')): reason='Market closed at arrival'
        elif not b or not b['valid']: reason='No valid book at arrival'
        elif t-b['t']>c.freshness: reason='Quote stale at arrival'
        else:
            rate=d(c.fee)/10000
            venue=meta.get('fee_rate') if c.venue_fee else None
            price_limit=d(c.limit) if buy else D('.01')
            metrics=self.metrics()
            budget=min(self.cash,d(c.exposure)-d(metrics['exposure']))
            if buy and d(metrics['equity'])<=1000-d(c.loss): reason='Session loss limit'
            elif buy and budget<=0: reason='Exposure or cash limit'
            else:
                for p in sorted(b[bookside],reverse=not buy):
                    if (buy and p>price_limit) or (not buy and p<price_limit): break
                    take=min(need-filled,b[bookside][p])
                    unit_fee=p*rate if venue is None else d(venue)*p*(1-p)
                    if buy:
                        fee_buffer=D('.000005') if venue else D(0)
                        take=min(take,max(D(0),(budget-notional-fee-fee_buffer)/(p+unit_fee)))
                    else: take=min(take,qty-filled)
                    take=take.quantize(D('.000001'),rounding='ROUND_DOWN')
                    if take<=0: continue
                    fills.append((p,take))
                    filled+=take
                    notional+=take*p
                    charge=take*unit_fee
                    fee+=charge.quantize(D('.00001'),rounding='ROUND_HALF_UP') if venue is not None else charge
                    if filled>=need: break
                if not filled: reason='No visible liquidity within limit'
                elif filled<need and not c.partial:
                    reason='Insufficient size; partial fills disabled'
                    fills=[]
                    filled=notional=fee=D(0)
                else:
                    reason='Visible size or risk budget exhausted' if filled<need else 'Matched visible liquidity'
                    for p,n in fills: b[bookside][p]-=n
                    self.fees+=fee
                    if buy:
                        self.cash-=notional+fee
                        self.positions[m]=(qty+filled,basis+notional+fee)
                        if c.hold:
                            self.schedule(t+c.hold,m,o['seq'],c,q,'SELL',filled)
                    else:
                        sold=basis*filled/qty
                        self.cash+=notional-fee
                        self.realized+=notional-fee-sold
                        self.positions[m]=(qty-filled,basis-sold)
        row=dict(**o,book=q,filled=num(filled),average=num(notional/filled) if filled else None,
                 fee_model=('Published taker rate '+str(meta['fee_rate']) if c.venue_fee and meta.get('fee_rate') is not None else f'{c.fee:g} bps assumed'),
                 fees=num(fee),outcome=('Missed' if not filled else 'Partial' if filled<need else 'Filled'),reason=reason)
        self.orders.append(row)
        self.trace.append(dict(**row,kind='result'))

    def ingest(self,e):
        t,k=e['t'],e['kind']
        self.advance(t,False)
        m=e.get('m')
        if k=='market': self.markets[m]=e['meta']
        elif k=='close' and m in self.markets:
            self.markets[m]={**self.markets[m],'closed':True}
            if e.get('payout') in ('0','1'):
                qty,basis=self.positions.pop(m,(D(0),D(0)))
                proceeds=qty*d(e['payout'])
                self.cash+=proceeds
                self.realized+=proceeds-basis
        elif k=='config' and self.honor: self.cfg=Config(**e['config'])
        elif k=='pause' and self.honor: self.paused=e['paused']
        elif k=='invalid' and m in self.books: self.books[m]['valid']=False
        elif k=='feed' and e.get('feed')=='Binance' and e.get('state')!='Connected': self.trades.clear()
        elif k=='book':
            prev=self.books.get(m)
            b=dict(t=t,seq=e['seq'],valid=True)
            for side in ('bids','asks'):
                raw={d(p):d(q) for p,q in e[side]}
                # Carry consumed liquidity across unchanged prices. Only newly displayed size replenishes it.
                b[side]={p:max(D(0),q-max(D(0),prev['raw'][side].get(p,D(0))-prev[side].get(p,D(0))))
                         if prev and prev['valid'] else q for p,q in raw.items()}
            b['raw']={side:{d(p):d(q) for p,q in e[side]} for side in ('bids','asks')}
            self.books[m]=b
        elif k=='trade':
            p=d(e['price'])
            self.price=p
            horizon=t-self.cfg.window
            while len(self.trades)>1 and self.trades[1][0]<=t-60000: self.trades.popleft()
            self.trades.append((t,p))
            ref=next((old for at,old in reversed(self.trades) if at<=horizon),None)
            if ref and p>ref and not self.paused:
                move=(p/ref-1)*10000
                for token,meta in self.markets.items():
                    if not meta.get('strategy',True): continue
                    c=self.cfg
                    q=self.quote(token,t)
                    if move<d(c.threshold): reason='Below BTC move threshold'
                    elif t-self.last.get(token,-10**12)<c.cooldown: reason='Cooldown active'
                    elif meta.get('closed') or t>=meta.get('close',float('inf')): reason='Market closed'
                    elif not q or not q['valid']: reason='Waiting for valid book'
                    elif q['age']>c.freshness: reason='Quote stale at signal'
                    elif not q['asks'] or d(q['asks'][0][0])>d(c.limit): reason='Ask above entry limit'
                    else: reason=''
                    # Keep rejected opportunities on the same identity as accepted ones.
                    s=dict(id=f"{e['seq']}:{token}:BUY",m=token,seq=e['seq'],t=t,move=num(move),quote=q,
                           accepted=not reason,reason=reason or 'Threshold and quote checks passed',config=c.model_dump())
                    self.signals.append(s)
                    if not reason:
                        self.last[token]=t
                        self.schedule(t,token,e['seq'],c,q,'BUY',d(c.size))
        self.sample(k=='close')

def run(events,end,cfg=None,honor=False):
    x=Engine(cfg,honor)
    for e in events:
        if e['t']>end: break
        x.ingest(e)
    x.advance(end)
    return x

def fixture(count=11,dense=False):
    events=[]
    def ev(t,kind,**kw): events.append(dict(t=t, kind=kind, **kw))
    names=['Bitcoin above $67,500 today?','Bitcoin above $68,000 today?','Bitcoin above $69,000 today?','Bitcoin up this hour?','Bitcoin above $70,000 Friday?','Bitcoin down this hour?','Bitcoin above $66,000 today?','Bitcoin above $72,000 this week?','Bitcoin above $65,000 today?','Bitcoin up tomorrow?','Bitcoin above $75,000 this month?']
    for i in range(count):
        m=f'm{i}'
        ev(0,'market',m=m,meta=dict(name=names[i] if i<len(names) else f'Bitcoin above ${68000+i*250:,}?', outcome='YES',cluster=i%3,close=22000+(i%3)*1000,strategy=i==0))
        if i: ev(5,'book',m=m,bids=[['.43','80']],asks=[['.49','72']])
    def main(t,ask,size=24):
        ev(t,'book',m='m0',bids=[['.51','68'],['.50','115'],['.49','164']],asks=[[str(ask),str(size)],[str(d(ask)+D('.02')),'42'],[str(d(ask)+D('.04')),'96']])
    main(0,'.54')
    main(1520,'.54')
    main(2740,'.59',40)
    main(5420,'.54',5)
    main(7980,'.55',6)
    main(8575,'.59',40)
    main(8840,'.59',40)
    main(11100,'.55',70)
    main(14000,'.54',60)
    main(17000,'.56',38)
    main(20000,'.54',50)
    for t in range(0,22001,25 if dense else 125):
        p=67420+sin(t/310)*3+sin(t/713)*5
        p+= (82 if 2500<=t<3200 else 68 if 6500<=t<7100 else 83 if 8500<=t<9200 else 0)
        ev(t,'trade',price=f'{p:.2f}')
        if dense or t%500==0:
            for j in range(2 if dense else 1):
                i=1+(t//(25 if dense else 500)+j*19)%max(1,count-1)
                if i<count:
                    price=D('.45')+D((t//25+i)%11)/100
                    ev(t,'book',m=f'm{i}',bids=[[str(price-D('.02')),'80']],asks=[[str(price),str(30+t%81)]])
    events.sort(key=lambda e:e['t'])
    for seq,e in enumerate(events,1): e['seq']=seq
    return events
