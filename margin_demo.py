"""
Margin Demonstration - Show how margin changes with positions
"""

import threading
import time
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.order import Order


class MarginDemo(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected = False
        self.next_order_id = None
        self.account_values = {}
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

    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice,
                   permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice):
        with self._lock:
            self.order_fills[orderId] = {
                'status': status,
                'filled': float(filled),
                'avgFillPrice': avgFillPrice,
            }

    def get_margin_info(self):
        """Get margin-related account values."""
        self.account_values.clear()
        tags = "NetLiquidation,AvailableFunds,BuyingPower,InitMarginReq,MaintMarginReq,ExcessLiquidity"
        self.reqAccountSummary(9001, "All", tags)
        time.sleep(2)
        self.cancelAccountSummary(9001)
        return self.account_values

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
                return fill.get('avgFillPrice', 0)
        return None


def print_margin_info(info, label):
    print(f"\n{'='*50}")
    print(f"  {label}")
    print(f"{'='*50}")

    fields = [
        ('NetLiquidation', 'Net Liquidation'),
        ('AvailableFunds', 'Available Funds'),
        ('BuyingPower', 'Buying Power'),
        ('InitMarginReq', 'Initial Margin Used'),
        ('MaintMarginReq', 'Maintenance Margin'),
        ('ExcessLiquidity', 'Excess Liquidity'),
    ]

    for key, label in fields:
        if key in info:
            val = info[key]['value']
            curr = info[key]['currency']
            print(f"  {label:25} {val:>15} {curr}")


def main():
    print("=" * 60)
    print("  MARGIN DEMONSTRATION - Paper Account")
    print("=" * 60)

    client = MarginDemo()
    client.connect("127.0.0.1", 7497, 105)

    api_thread = threading.Thread(target=client.run, daemon=True)
    api_thread.start()

    timeout = 10
    start = time.time()
    while not client.connected and time.time() - start < timeout:
        time.sleep(0.1)

    if not client.connected:
        print("Failed to connect!")
        return

    print("\nConnected to Paper Account!")

    # Step 1: Show margin BEFORE opening position
    info_before = client.get_margin_info()
    print_margin_info(info_before, "BEFORE OPENING POSITION")

    # Step 2: Open a position
    print("\n" + "-" * 50)
    print("  Opening BUY 50,000 EUR/USD position...")
    print("-" * 50)

    fill_price = client.place_market_order("EUR", "USD", "BUY", 50000)
    if fill_price:
        print(f"  Filled at: {fill_price}")
        position_value = 50000 * fill_price
        print(f"  Position value: ${position_value:,.2f} USD")
    else:
        print("  Order failed!")
        client.disconnect()
        return

    time.sleep(2)

    # Step 3: Show margin AFTER opening position
    info_after = client.get_margin_info()
    print_margin_info(info_after, "AFTER OPENING 50K EUR/USD POSITION")

    # Calculate the difference
    print("\n" + "=" * 50)
    print("  MARGIN IMPACT")
    print("=" * 50)

    margin_before = float(info_before.get('InitMarginReq', {}).get('value', 0))
    margin_after = float(info_after.get('InitMarginReq', {}).get('value', 0))
    margin_used = margin_after - margin_before

    avail_before = float(info_before.get('AvailableFunds', {}).get('value', 0))
    avail_after = float(info_after.get('AvailableFunds', {}).get('value', 0))
    avail_change = avail_after - avail_before

    print(f"  Margin used for 50K position: {margin_used:,.2f} CHF")
    print(f"  Available funds change: {avail_change:,.2f} CHF")
    print(f"  Leverage ratio: ~{position_value / margin_used:.0f}:1" if margin_used > 0 else "")

    # Step 4: Close the position
    print("\n" + "-" * 50)
    print("  Closing position...")
    print("-" * 50)

    close_price = client.place_market_order("EUR", "USD", "SELL", 50000)
    if close_price:
        print(f"  Closed at: {close_price}")
        pnl = (close_price - fill_price) * 50000
        print(f"  P&L: ${pnl:+.2f} USD")

    time.sleep(2)

    # Step 5: Show margin AFTER closing
    info_final = client.get_margin_info()
    print_margin_info(info_final, "AFTER CLOSING POSITION")

    print("\n" + "=" * 60)
    print("  DEMONSTRATION COMPLETE")
    print("=" * 60)

    client.disconnect()


if __name__ == "__main__":
    main()
