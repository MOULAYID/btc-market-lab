import unittest
from engine import Engine, Config, D, fixture, run

def inputs(*extra, close=10000, size='5'):
    e=[
        dict(t=0,kind='market',m='m',meta={'close':close}),
        dict(t=0,kind='trade',price='100'),
        dict(t=100,kind='book',m='m',bids=[['.49','20']],asks=[['.50',size]]),
        dict(t=1000,kind='trade',price='101'),
        *extra,
    ]
    return [dict(x,seq=i) for i,x in enumerate(sorted(e,key=lambda x:x['t']),1)]

def ask(t,p='.60',q='10'):
    return dict(t=t,kind='book',m='m',bids=[['.49','20']],asks=[[p,q]])

class Execution(unittest.TestCase):
    def test_delay_race_and_identical_recording(self):
        e=fixture()
        fast=run(e,22000)
        slow=run(e,22000,Config(delay=500))
        self.assertEqual(fast.orders[0]['outcome'],'Filled')
        self.assertEqual(slow.orders[0]['outcome'],'Missed')
        self.assertEqual(fast.orders[0]['id'],slow.orders[0]['id'])
        self.assertEqual(fast.orders[0]['quote'],slow.orders[0]['quote'])
        self.assertEqual(slow.orders[0]['book']['asks'][0][0],'0.59')
        self.assertTrue(any(o['outcome']=='Missed' for o in fast.orders))

    def test_after_arrival_and_equal_time_ordering(self):
        ev=inputs(ask(1101))
        self.assertEqual(run(ev,1500).orders[0]['outcome'],'Partial')
        self.assertEqual(run(inputs(ask(1100)),1500).orders[0]['outcome'],'Missed')

    def test_stale_and_invalid(self):
        self.assertIn('stale',run(inputs(),1400,Config(freshness=950)).orders[0]['reason'].lower())
        invalid=dict(t=1050,kind='invalid',m='m')
        self.assertEqual(run(inputs(invalid,ask(1110,'.50')),1400).orders[0]['reason'],'No valid book at arrival')
        self.assertEqual(run(inputs(invalid,ask(1090,'.50')),1400).orders[0]['outcome'],'Partial')

    def test_close_at_arrival(self):
        self.assertEqual(run(inputs(close=1100),1500).orders[0]['reason'],'Market closed at arrival')

    def test_repeated_orders_and_fees(self):
        ev=inputs(ask(1200,'.50','5'),dict(t=1300,kind='trade',price='102'))
        x=run(ev,1500,Config(size=4,fee=100,cooldown=0))
        self.assertEqual([o['filled'] for o in x.orders],[4,1])
        self.assertEqual(x.cash,D('997.475'))
        self.assertEqual(x.fees,D('.025'))
        self.assertEqual(x.positions['m'],(D(5),D('2.525')))
        self.assertAlmostEqual(x.metrics()['unrealized'],-.075)

    def test_exit_and_settlement(self):
        x=run(inputs(),1500,Config(size=4,hold=100,fee=100))
        self.assertEqual([o['side'] for o in x.orders],['BUY','SELL'])
        self.assertEqual(x.realized,D('-.0796'))
        x=run(inputs(dict(t=1400,kind='close',m='m',payout='1')),1500,Config(size=4))
        self.assertEqual(x.realized,D(2))
        self.assertFalse(x.metrics()['positions'])

    def test_partial_disabled(self):
        x=run(inputs(),1500,Config(partial=False))
        self.assertEqual(x.orders[0]['filled'],0)
        self.assertEqual(x.cash,D(1000))

    def test_seek_and_presentation_speed(self):
        ev=fixture()
        baseline=run(ev,22000)
        for t in (9000,100,3000,22000):
            x=run(ev,t)
            self.assertEqual(x.orders,[o for o in baseline.orders if o['arrival']<=t])
        self.assertEqual(run(ev,22000).stats,baseline.stats)

    def test_examples_and_dense_sequence(self):
        e=fixture()
        self.assertFalse(next(s for s in run(e,22000,Config(threshold=11)).signals if s['t']==6500)['accepted'])
        self.assertEqual(run(e,22000,Config(size=80)).orders[0]['outcome'],'Partial')
        x=fixture(50,True)
        self.assertEqual(len(run(x,22000).markets),50)
        self.assertEqual([e['seq'] for e in x],list(range(1,len(x)+1)))

    def test_future_quote_prevention(self):
        # 1. Signal time: Book quote arrives with future timestamp (t=200 > signal t=50)
        ev_sig=[
            dict(seq=1, t=0, kind='market', m='m', meta={'close': 10000}),
            dict(seq=2, t=0, kind='trade', price='100'),
            dict(seq=3, t=200, kind='book', m='m', bids=[['.49','20']], asks=[['.50','20']]),
            dict(seq=4, t=50, kind='trade', price='101'),
        ]
        x_sig = run(ev_sig, 500, Config(delay=50, window=10))
        self.assertEqual(len(x_sig.signals), 1)
        self.assertFalse(x_sig.signals[0]['accepted'])
        self.assertEqual(x_sig.signals[0]['reason'], 'Quote from future at signal')

        # 2. Arrival time: Book timestamp is ahead of order arrival
        ev_arr=[
            dict(seq=1, t=0, kind='market', m='m', meta={'close': 10000}),
            dict(seq=2, t=0, kind='trade', price='100'),
            dict(seq=3, t=40, kind='book', m='m', bids=[['.49','20']], asks=[['.50','20']]),
            dict(seq=4, t=50, kind='trade', price='101'), # arrival at 100
        ]
        x_arr = Engine(Config(delay=50, window=10))
        for e in ev_arr: x_arr.ingest(e)
        x_arr.books['m']['t'] = 150 # future quote at arrival
        x_arr.advance(200)
        self.assertEqual(len(x_arr.orders), 1)
        self.assertEqual(x_arr.orders[0]['outcome'], 'Missed')
        self.assertEqual(x_arr.orders[0]['reason'], 'Quote from future at arrival')

    def test_close_none_and_after_close(self):
        # Ensure meta['close'] = None does not trigger TypeError
        ev=[
            dict(seq=1, t=0, kind='market', m='m', meta={'close': None}),
            dict(seq=2, t=0, kind='trade', price='100'),
            dict(seq=3, t=100, kind='book', m='m', bids=[['.49','20']], asks=[['.50','20']]),
            dict(seq=4, t=1000, kind='trade', price='101'),
        ]
        x = run(ev, 1500)
        self.assertEqual(x.orders[0]['outcome'], 'Filled')

        # Order arriving after explicit market close is rejected
        ev_closed=[
            dict(seq=1, t=0, kind='market', m='m', meta={'close': 1050}),
            dict(seq=2, t=0, kind='trade', price='100'),
            dict(seq=3, t=100, kind='book', m='m', bids=[['.49','20']], asks=[['.50','20']]),
            dict(seq=4, t=1000, kind='trade', price='101'), # arrival 1100 > close 1050
        ]
        x_closed = run(ev_closed, 1500)
        self.assertEqual(x_closed.orders[0]['reason'], 'Market closed at arrival')

    def test_pl_reconciliation_identity(self):
        ev=fixture()
        x=run(ev, 22000, Config(hold=500, fee=10))
        m=x.metrics()
        # Equity == 1000 + Realized + Unrealized
        self.assertAlmostEqual(m['equity'], 1000.0 + m['realized'] + m['unrealized'], places=5)
        # Cash + Cost basis == 1000 + Realized
        self.assertAlmostEqual(m['cash'] + m['exposure'], 1000.0 + m['realized'], places=5)

if __name__=='__main__': unittest.main()
