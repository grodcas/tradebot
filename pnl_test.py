"""
P&L Verification Test

1. Check initial balance
2. Place trades
3. Close trades
4. Check final balance
5. Compare P&L
"""

import threading
import time
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.order import Order


class PnLTester(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected = False
        self.next_order_id = None
        self.account_values = {}
        self.positions = {}
        self.order_fills = {}
        self._lock = threading.Lock()

    def connectAck(self):
        pass

    def nextValidId(self, orderId):
        self.next_order_id = orderId
        self.connected = True

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        if errorCode not in [2104, 2106, 2158, 2119, 10349, 399, 10285]:
            print(f"  [ERROR {errorCode}] {errorString}")

    def accountSummary(self, reqId, account, tag, value, currency):
        with self._lock:
            self.account_values[tag] = {'value': value, 'currency': currency}

    def accountSummaryEnd(self, reqId):
        pass

    def position(self, account, contract, position, avgCost):
        key = f"{contract.symbol}/{contract.currency}"
        with self._lock:
            self.positions[key] = float(position)

    def positionEnd(self):
        pass

    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice,
                   permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice):
        with self._lock:
            self.order_fills[orderId] = {
                'status': status,
                'filled': float(filled),
                'avgFillPrice': avgFillPrice,
            }

    def get_balance(self):
        """Get current net liquidation value."""
        self.account_values.clear()
        self.reqAccountSummary(9001, "All", "NetLiquidation,TotalCashValue")
        time.sleep(2)
        self.cancelAccountSummary(9001)

        net_liq = self.account_values.get('NetLiquidation', {})
        return float(net_liq.get('value', 0)), net_liq.get('currency', 'USD')

    def get_position(self, base, quote):
        """Get position for a pair."""
        self.positions.clear()
        self.reqPositions()
        time.sleep(1)
        self.cancelPositions()
        key = f"{base}/{quote}"
        return self.positions.get(key, 0)

    def place_market_order(self, base, quote, action, quantity):
        """Place market order and wait for fill."""
        contract = Contract()
        contract.symbol = base
        contract.currency = quote
        contract.secType = "CASH"
        contract.exchange = "IDEALPRO"

        order = Order()
        order.action = action
        order.orderType = "MKT"
        order.totalQuantity = quantity
        order.transmit = True
        order.eTradeOnly = False
        order.firmQuoteOnly = False

        order_id = self.next_order_id
        self.next_order_id += 1

        self.placeOrder(order_id, contract, order)

        # Wait for fill
        timeout = 10
        start = time.time()
        while time.time() - start < timeout:
            time.sleep(0.2)
            fill = self.order_fills.get(order_id, {})
            if fill.get('status') == 'Filled':
                return {
                    'orderId': order_id,
                    'action': action,
                    'quantity': quantity,
                    'fillPrice': fill.get('avgFillPrice', 0),
                }
        return None


def main():
    print("=" * 60)
    print("P&L VERIFICATION TEST")
    print("=" * 60)

    client = PnLTester()
    client.connect("127.0.0.1", 7497, 104)

    api_thread = threading.Thread(target=client.run, daemon=True)
    api_thread.start()

    timeout = 10
    start = time.time()
    while not client.connected and time.time() - start < timeout:
        time.sleep(0.1)

    if not client.connected:
        print("Failed to connect!")
        return

    print("\n[1] CHECKING INITIAL BALANCE...")
    initial_balance, currency = client.get_balance()
    print(f"    Initial Balance: {initial_balance:,.2f} {currency}")

    # Store for P&L calculation
    trades = []
    total_commission = 0

    # --- TRADE 1: EUR/USD ---
    print("\n[2] TRADE 1: EUR/USD")
    print("    Opening LONG 20,000 EUR/USD...")
    buy1 = client.place_market_order("EUR", "USD", "BUY", 20000)
    if buy1:
        print(f"    OK - Bought at {buy1['fillPrice']:.5f}")
        trades.append(buy1)
        total_commission += 2  # $2 commission
    time.sleep(1)

    print("    Closing position...")
    sell1 = client.place_market_order("EUR", "USD", "SELL", 20000)
    if sell1:
        print(f"    OK - Sold at {sell1['fillPrice']:.5f}")
        trades.append(sell1)
        total_commission += 2

    # Calculate P&L for trade 1
    if buy1 and sell1:
        pnl1 = (sell1['fillPrice'] - buy1['fillPrice']) * 20000
        print(f"    Trade P&L: ${pnl1:+.2f} (before commission)")

    time.sleep(2)

    # --- TRADE 2: USD/JPY ---
    print("\n[3] TRADE 2: USD/JPY")
    print("    Opening LONG 20,000 USD/JPY...")
    buy2 = client.place_market_order("USD", "JPY", "BUY", 20000)
    if buy2:
        print(f"    OK - Bought at {buy2['fillPrice']:.3f}")
        trades.append(buy2)
        total_commission += 2
    time.sleep(1)

    print("    Closing position...")
    sell2 = client.place_market_order("USD", "JPY", "SELL", 20000)
    if sell2:
        print(f"    OK - Sold at {sell2['fillPrice']:.3f}")
        trades.append(sell2)
        total_commission += 2

    # Calculate P&L for trade 2 (in USD)
    if buy2 and sell2:
        pnl2_jpy = (sell2['fillPrice'] - buy2['fillPrice']) * 20000
        pnl2_usd = pnl2_jpy / sell2['fillPrice']  # Convert JPY to USD
        print(f"    Trade P&L: ¥{pnl2_jpy:+.0f} (${pnl2_usd:+.2f} USD, before commission)")

    time.sleep(2)

    # --- TRADE 3: GBP/USD ---
    print("\n[4] TRADE 3: GBP/USD")
    print("    Opening SHORT 20,000 GBP/USD...")
    sell3 = client.place_market_order("GBP", "USD", "SELL", 20000)
    if sell3:
        print(f"    OK - Sold at {sell3['fillPrice']:.5f}")
        trades.append(sell3)
        total_commission += 2
    time.sleep(1)

    print("    Closing position...")
    buy3 = client.place_market_order("GBP", "USD", "BUY", 20000)
    if buy3:
        print(f"    OK - Bought at {buy3['fillPrice']:.5f}")
        trades.append(buy3)
        total_commission += 2

    # Calculate P&L for trade 3
    if sell3 and buy3:
        pnl3 = (sell3['fillPrice'] - buy3['fillPrice']) * 20000
        print(f"    Trade P&L: ${pnl3:+.2f} (before commission)")

    time.sleep(3)

    # --- CHECK FINAL BALANCE ---
    print("\n[5] CHECKING FINAL BALANCE...")
    final_balance, currency = client.get_balance()
    print(f"    Final Balance: {final_balance:,.2f} {currency}")

    # --- SUMMARY ---
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    balance_change = final_balance - initial_balance
    print(f"\n  Initial Balance:  {initial_balance:,.2f} {currency}")
    print(f"  Final Balance:    {final_balance:,.2f} {currency}")
    print(f"  -----------------------------")
    print(f"  Balance Change:   {balance_change:+,.2f} {currency}")

    # Calculate expected P&L
    expected_gross = 0
    if buy1 and sell1:
        expected_gross += (sell1['fillPrice'] - buy1['fillPrice']) * 20000
    if buy2 and sell2:
        pnl2_jpy = (sell2['fillPrice'] - buy2['fillPrice']) * 20000
        expected_gross += pnl2_jpy / sell2['fillPrice']
    if sell3 and buy3:
        expected_gross += (sell3['fillPrice'] - buy3['fillPrice']) * 20000

    print(f"\n  Expected Gross P&L: ${expected_gross:+.2f}")
    print(f"  Total Commissions:  ${total_commission:.2f}")
    print(f"  Expected Net P&L:   ${expected_gross - total_commission:+.2f}")

    # Convert balance change to USD for comparison (approximate)
    if currency == 'CHF':
        balance_change_usd = balance_change * 1.13  # Approximate CHF to USD
        print(f"\n  Balance Change (approx USD): ${balance_change_usd:+.2f}")

    print("\n" + "=" * 60)

    client.disconnect()


if __name__ == "__main__":
    main()
