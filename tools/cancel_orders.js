require('dotenv').config();
const https = require('https');

const accountId = process.env.OANDA_ACCOUNT_ID;
const token = process.env.OANDA_API_TOKEN;
const host = 'api-fxpractice.oanda.com';

function oandaRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path: '/v3/accounts/' + accountId + path,
      method: method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function cancelAll() {
  console.log('Fetching pending orders...');
  const orders = await oandaRequest('/pendingOrders');

  if (!orders.data.orders || orders.data.orders.length === 0) {
    console.log('No pending orders to cancel.');
    return;
  }

  console.log('Found', orders.data.orders.length, 'pending orders');

  for (const o of orders.data.orders) {
    if (o.type === 'LIMIT' || o.type === 'STOP' || o.type === 'MARKET_IF_TOUCHED') {
      console.log('Cancelling order', o.id, '(' + o.instrument + ' ' + o.units + ' @ ' + o.price + ')');
      const result = await oandaRequest('/orders/' + o.id + '/cancel', 'PUT');
      console.log('  Result:', result.status === 200 ? 'Cancelled' : 'Failed');
    }
  }

  console.log('Done!');
}

cancelAll().catch(console.error);
