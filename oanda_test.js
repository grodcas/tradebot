/**
 * OANDA API Connection Test
 *
 * Tests connectivity to OANDA v20 REST API
 *
 * Usage:
 *   1. Set your credentials in .env file:
 *      OANDA_API_TOKEN=your_api_token
 *      OANDA_ACCOUNT_ID=XXX-XXX-XXXXXXXX-XXX
 *      OANDA_ENVIRONMENT=practice  (or "live")
 *
 *   2. Run: node oanda_test.js
 */

require('dotenv').config();

const OANDA_API_TOKEN = process.env.OANDA_API_TOKEN;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID;
const OANDA_ENVIRONMENT = process.env.OANDA_ENVIRONMENT || 'practice';

// OANDA API endpoints
const ENDPOINTS = {
  practice: {
    rest: 'https://api-fxpractice.oanda.com',
    stream: 'https://stream-fxpractice.oanda.com'
  },
  live: {
    rest: 'https://api-fxtrade.oanda.com',
    stream: 'https://stream-fxtrade.oanda.com'
  }
};

const baseUrl = ENDPOINTS[OANDA_ENVIRONMENT]?.rest;
const streamUrl = ENDPOINTS[OANDA_ENVIRONMENT]?.stream;

console.log('='.repeat(50));
console.log('OANDA API Connection Test');
console.log('='.repeat(50));
console.log(`Environment: ${OANDA_ENVIRONMENT}`);
console.log(`API Base URL: ${baseUrl}`);
console.log(`Account ID: ${OANDA_ACCOUNT_ID || 'NOT SET'}`);
console.log('');

if (!OANDA_API_TOKEN) {
  console.error('ERROR: Missing API token!');
  console.error('');
  console.error('To get your OANDA API token:');
  console.error('  1. Log into https://www.oanda.com/account/tpa/personal_token');
  console.error('  2. Or go to fxTrade -> Account Management Portal -> Manage API Access');
  console.error('  3. Generate a new personal access token');
  console.error('');
  console.error('Then add to your .env file:');
  console.error('  OANDA_API_TOKEN=your_token_here');
  process.exit(1);
}

if (!OANDA_ACCOUNT_ID) {
  console.error('ERROR: Missing Account ID!');
  console.error('');
  console.error('Your Account ID is visible in OANDA fxTrade platform.');
  console.error('Format: XXX-XXX-XXXXXXXX-XXX');
  console.error('');
  console.error('Add to your .env file:');
  console.error('  OANDA_ACCOUNT_ID=101-001-12345678-001');
  process.exit(1);
}

/**
 * Make authenticated request to OANDA API
 */
async function oandaRequest(endpoint, method = 'GET', body = null) {
  const url = `${baseUrl}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${OANDA_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept-Datetime-Format': 'UNIX'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API Error: ${data.errorMessage || JSON.stringify(data)}`);
  }

  return data;
}

async function testConnection() {
  try {
    // Step 1: Test authentication - Get accounts
    console.log('[1/5] Testing authentication...');
    const accountsResponse = await oandaRequest('/v3/accounts');
    console.log('      Authentication successful!');
    console.log(`      Found ${accountsResponse.accounts.length} account(s)`);

    for (const acc of accountsResponse.accounts) {
      console.log(`      - ${acc.id} (${acc.tags?.join(', ') || 'no tags'})`);
    }
    console.log('');

    // Step 2: Get account details
    console.log('[2/5] Getting account details...');
    const accountDetails = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}`);
    const account = accountDetails.account;

    console.log(`      Account ID: ${account.id}`);
    console.log(`      Currency: ${account.currency}`);
    console.log(`      Balance: ${parseFloat(account.balance).toFixed(2)} ${account.currency}`);
    console.log(`      NAV: ${parseFloat(account.NAV).toFixed(2)} ${account.currency}`);
    console.log(`      Unrealized P&L: ${parseFloat(account.unrealizedPL).toFixed(2)}`);
    console.log(`      Margin Used: ${parseFloat(account.marginUsed).toFixed(2)}`);
    console.log(`      Margin Available: ${parseFloat(account.marginAvailable).toFixed(2)}`);
    console.log(`      Open Trades: ${account.openTradeCount}`);
    console.log(`      Open Positions: ${account.openPositionCount}`);
    console.log('');

    // Step 3: Get tradeable instruments
    console.log('[3/5] Getting tradeable instruments...');
    const instrumentsResponse = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/instruments`);
    const instruments = instrumentsResponse.instruments;

    // Find forex pairs
    const forexPairs = instruments.filter(i => i.type === 'CURRENCY');
    console.log(`      Total instruments: ${instruments.length}`);
    console.log(`      Forex pairs: ${forexPairs.length}`);

    // Show some common pairs
    const commonPairs = ['EUR_USD', 'USD_JPY', 'GBP_USD', 'USD_CHF', 'AUD_USD'];
    console.log('      Common pairs available:');
    for (const pair of commonPairs) {
      const inst = instruments.find(i => i.name === pair);
      if (inst) {
        console.log(`        - ${inst.displayName} (pip: ${inst.pipLocation})`);
      }
    }
    console.log('');

    // Step 4: Get current prices
    console.log('[4/5] Getting current prices...');
    const pricingResponse = await oandaRequest(
      `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=EUR_USD,USD_JPY,GBP_USD`
    );

    for (const price of pricingResponse.prices) {
      const bid = parseFloat(price.bids[0]?.price || 0);
      const ask = parseFloat(price.asks[0]?.price || 0);
      const spread = (ask - bid) * (price.instrument.includes('JPY') ? 100 : 10000);
      console.log(`      ${price.instrument}: Bid=${bid.toFixed(5)} Ask=${ask.toFixed(5)} Spread=${spread.toFixed(1)} pips`);
    }
    console.log('');

    // Step 5: Test streaming (briefly)
    console.log('[5/5] Testing price streaming...');
    console.log('      Connecting to streaming endpoint...');

    const streamResponse = await fetch(
      `${streamUrl}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing/stream?instruments=EUR_USD`,
      {
        headers: {
          'Authorization': `Bearer ${OANDA_API_TOKEN}`,
        }
      }
    );

    if (streamResponse.ok) {
      console.log('      Streaming connection established!');
      console.log('      Reading a few price updates...\n');

      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let tickCount = 0;

      while (tickCount < 3) {
        const { value, done } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === 'PRICE') {
              tickCount++;
              const bid = parseFloat(data.bids[0]?.price || 0);
              const ask = parseFloat(data.asks[0]?.price || 0);
              console.log(`      Tick ${tickCount}: EUR/USD Bid=${bid.toFixed(5)} Ask=${ask.toFixed(5)}`);
            }
          } catch (e) {
            // Heartbeat or other message
          }
        }
      }

      reader.cancel();
    } else {
      console.log('      Streaming test skipped (connection issue)');
    }

    console.log('\n' + '='.repeat(50));
    console.log('SUCCESS! OANDA API is working!');
    console.log('='.repeat(50));
    console.log('\nYour OANDA account is ready for API trading.');
    console.log('');
    console.log('Account Summary:');
    console.log(`  Balance: ${parseFloat(account.balance).toFixed(2)} ${account.currency}`);
    console.log(`  Environment: ${OANDA_ENVIRONMENT}`);
    console.log('');
    console.log('Next: Run your trading bot with OANDA integration!');
    console.log('');

  } catch (error) {
    console.error('\n' + '='.repeat(50));
    console.error('CONNECTION FAILED');
    console.error('='.repeat(50));
    console.error(`Error: ${error.message}`);
    console.error('');
    console.error('Possible reasons:');
    console.error('  - Invalid API token (regenerate at oanda.com)');
    console.error('  - Wrong Account ID format');
    console.error('  - Wrong environment (practice vs live)');
    console.error('  - Network/firewall issues');
    console.error('');
    console.error('Verify your credentials at:');
    console.error('  https://www.oanda.com/account/tpa/personal_token');
    process.exit(1);
  }
}

// Run the test
testConnection();
