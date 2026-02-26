"""
IBKR Order Execution Test Script

Tests connection and basic order operations with TWS/IB Gateway paper account.
Uses the classic EClient/EWrapper pattern.
"""

import threading
import time
from decimal import Decimal
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.order import Order


class IBKRClient(EWrapper, EClient):
    """Combined EWrapper and EClient for IBKR connection."""

    def __init__(self):
        EClient.__init__(self, self)
        self.next_order_id = None
        self.connected = False
        self.positions = {}
        self.open_orders = {}
        self.order_status_updates = {}
        self.contract_details = {}
        self.market_data = {}
        self._lock = threading.Lock()

    # === Connection Callbacks ===
    def connectAck(self):
        print("[INFO] Connection acknowledged")

    def nextValidId(self, orderId: int):
        """Called when connection is ready with next valid order ID."""
        self.next_order_id = orderId
        self.connected = True
        print(f"[INFO] Connected! Next valid order ID: {orderId}")

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        """Handle errors from TWS."""
        # Info messages (not errors)
        if errorCode in [2104, 2106, 2158, 2119]:
            print(f"[INFO] {errorCode}: {errorString}")
        else:
            print(f"[ERROR] ReqId: {reqId}, Code: {errorCode}, Msg: {errorString}")

    # === Order Callbacks ===
    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice,
                   permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice):
        """Called when order status changes."""
        with self._lock:
            self.order_status_updates[orderId] = {
                'orderId': orderId,
                'status': status,
                'filled': filled,
                'remaining': remaining,
                'avgFillPrice': avgFillPrice,
                'permId': permId,
                'parentId': parentId,
                'lastFillPrice': lastFillPrice,
            }
        print(f"[ORDER] ID: {orderId}, Status: {status}, Filled: {filled}, "
              f"Remaining: {remaining}, AvgPrice: {avgFillPrice}")

    def openOrder(self, orderId, contract, order, orderState):
        """Called when an open order is received."""
        with self._lock:
            self.open_orders[orderId] = {
                'orderId': orderId,
                'contract': contract,
                'order': order,
                'orderState': orderState,
            }
        print(f"[OPEN ORDER] ID: {orderId}, {contract.symbol}/{contract.currency}, "
              f"{order.action} {order.totalQuantity} @ {order.orderType}")

    def execDetails(self, reqId, contract, execution):
        """Called when an execution occurs."""
        print(f"[EXEC] {contract.symbol}/{contract.currency}: {execution.side} "
              f"{execution.shares} @ {execution.price}")

    # === Position Callbacks ===
    def position(self, account, contract, position, avgCost):
        """Called for each position in account."""
        key = f"{contract.symbol}/{contract.currency}"
        with self._lock:
            self.positions[key] = {
                'account': account,
                'contract': contract,
                'position': position,
                'avgCost': avgCost,
            }
        print(f"[POSITION] {key}: {position} @ avg {avgCost}")

    def positionEnd(self):
        """Called when all positions have been received."""
        print(f"[INFO] Position download complete. Total: {len(self.positions)}")

    # === Market Data Callbacks ===
    def tickPrice(self, reqId, tickType, price, attrib):
        """Called for price updates."""
        with self._lock:
            if reqId not in self.market_data:
                self.market_data[reqId] = {}
            self.market_data[reqId][tickType] = price
        # tickType: 1=bid, 2=ask, 4=last, 6=high, 7=low, 9=close
        tick_names = {1: 'BID', 2: 'ASK', 4: 'LAST', 6: 'HIGH', 7: 'LOW', 9: 'CLOSE'}
        name = tick_names.get(tickType, str(tickType))
        print(f"[TICK] ReqId: {reqId}, {name}: {price}")


def create_forex_contract(base_currency: str, quote_currency: str) -> Contract:
    """Create a forex contract for IBKR."""
    contract = Contract()
    contract.symbol = base_currency
    contract.currency = quote_currency
    contract.secType = "CASH"
    contract.exchange = "IDEALPRO"
    return contract


def create_market_order(action: str, quantity: float) -> Order:
    """Create a market order."""
    order = Order()
    order.action = action  # "BUY" or "SELL"
    order.orderType = "MKT"
    order.totalQuantity = quantity
    order.transmit = True
    # Explicitly set attributes to avoid version compatibility issues
    order.eTradeOnly = False
    order.firmQuoteOnly = False
    return order


def create_limit_order(action: str, quantity: float, limit_price: float) -> Order:
    """Create a limit order."""
    order = Order()
    order.action = action
    order.orderType = "LMT"
    order.totalQuantity = quantity
    order.lmtPrice = limit_price
    order.transmit = True
    order.eTradeOnly = False
    order.firmQuoteOnly = False
    return order


def create_bracket_order(parent_id: int, action: str, quantity: float,
                         limit_price: float, take_profit: float, stop_loss: float):
    """
    Create a bracket order (entry + TP + SL).
    Returns tuple of (parent_order, take_profit_order, stop_loss_order)
    """
    # Parent order (entry)
    parent = Order()
    parent.orderId = parent_id
    parent.action = action
    parent.orderType = "LMT"
    parent.totalQuantity = quantity
    parent.lmtPrice = limit_price
    parent.transmit = False  # Don't transmit yet
    parent.eTradeOnly = False
    parent.firmQuoteOnly = False

    # Take Profit order
    tp_action = "SELL" if action == "BUY" else "BUY"
    take_profit_order = Order()
    take_profit_order.orderId = parent_id + 1
    take_profit_order.action = tp_action
    take_profit_order.orderType = "LMT"
    take_profit_order.totalQuantity = quantity
    take_profit_order.lmtPrice = take_profit
    take_profit_order.parentId = parent_id
    take_profit_order.transmit = False
    take_profit_order.eTradeOnly = False
    take_profit_order.firmQuoteOnly = False

    # Stop Loss order
    stop_loss_order = Order()
    stop_loss_order.orderId = parent_id + 2
    stop_loss_order.action = tp_action
    stop_loss_order.orderType = "STP"
    stop_loss_order.totalQuantity = quantity
    stop_loss_order.auxPrice = stop_loss  # Stop price
    stop_loss_order.parentId = parent_id
    stop_loss_order.transmit = True  # Transmit all orders together
    stop_loss_order.eTradeOnly = False
    stop_loss_order.firmQuoteOnly = False

    return parent, take_profit_order, stop_loss_order


def main():
    """Test IBKR connection and order operations."""

    print("=" * 60)
    print("IBKR Order Execution Test")
    print("=" * 60)

    # Create client and connect
    client = IBKRClient()

    # Connect to IB Gateway Paper (port 4002) or TWS Paper (port 7497)
    host = "127.0.0.1"
    port = 7497  # TWS Paper
    client_id = 200  # Different from live_trader to avoid conflicts

    print(f"\n[INFO] Connecting to {host}:{port} with client ID {client_id}...")
    client.connect(host, port, client_id)

    # Start message processing thread
    api_thread = threading.Thread(target=client.run, daemon=True)
    api_thread.start()

    # Wait for connection
    timeout = 10
    start = time.time()
    while not client.connected and time.time() - start < timeout:
        time.sleep(0.1)

    if not client.connected:
        print("[ERROR] Failed to connect to TWS/IB Gateway")
        return

    print("\n[SUCCESS] Connected to IBKR!")
    time.sleep(1)  # Let connection stabilize

    # === Test 1: Get Current Positions ===
    print("\n" + "=" * 40)
    print("TEST 1: Get Current Positions")
    print("=" * 40)
    client.reqPositions()
    time.sleep(2)

    # === Test 2: Request Market Data for EUR/USD ===
    print("\n" + "=" * 40)
    print("TEST 2: Get EUR/USD Market Data")
    print("=" * 40)
    eurusd = create_forex_contract("EUR", "USD")
    client.reqMktData(1001, eurusd, "", False, False, [])
    time.sleep(3)

    # Cancel market data subscription
    client.cancelMktData(1001)

    # Get current bid/ask
    bid = client.market_data.get(1001, {}).get(1, 0)
    ask = client.market_data.get(1001, {}).get(2, 0)
    print(f"\n[RESULT] EUR/USD Bid: {bid}, Ask: {ask}")

    # === Test 3: Place a Small Market Order ===
    print("\n" + "=" * 40)
    print("TEST 3: Place Small Market Order (BUY 1000 EUR/USD)")
    print("=" * 40)

    order_id = client.next_order_id
    market_order = create_market_order("BUY", 1000)  # Minimum forex size

    print(f"[INFO] Placing market order with ID: {order_id}")
    client.placeOrder(order_id, eurusd, market_order)
    client.next_order_id += 1

    time.sleep(3)

    # === Test 4: Check Open Orders ===
    print("\n" + "=" * 40)
    print("TEST 4: Check Open Orders")
    print("=" * 40)
    client.reqAllOpenOrders()
    time.sleep(2)

    # === Test 5: Check Updated Positions ===
    print("\n" + "=" * 40)
    print("TEST 5: Check Updated Positions")
    print("=" * 40)
    client.positions.clear()
    client.reqPositions()
    time.sleep(2)

    # === Test 6: Close Position (Sell to flatten) ===
    print("\n" + "=" * 40)
    print("TEST 6: Close Position (SELL 1000 EUR/USD)")
    print("=" * 40)

    order_id = client.next_order_id
    close_order = create_market_order("SELL", 1000)

    print(f"[INFO] Placing close order with ID: {order_id}")
    client.placeOrder(order_id, eurusd, close_order)
    client.next_order_id += 1

    time.sleep(3)

    # === Final Position Check ===
    print("\n" + "=" * 40)
    print("FINAL: Verify Position Closed")
    print("=" * 40)
    client.positions.clear()
    client.reqPositions()
    time.sleep(2)

    # === Disconnect ===
    print("\n[INFO] Disconnecting...")
    client.disconnect()
    print("[SUCCESS] Test complete!")


if __name__ == "__main__":
    main()
