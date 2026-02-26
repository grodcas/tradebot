"""
IBKR Order Executor

Real order execution for forex trading through IBKR TWS/Gateway.
Supports market orders, limit orders, bracket orders (entry + TP + SL).

This module can be called from Node.js via child process or used standalone.
"""

import sys
import json
import threading
import time
from decimal import Decimal
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.order import Order


class IBKRExecutor(EWrapper, EClient):
    """IBKR order execution client."""

    def __init__(self, host="127.0.0.1", port=7497, client_id=100):
        EClient.__init__(self, self)
        self.host = host
        self.port = port
        self.client_id = client_id

        self.next_order_id = None
        self.connected = False
        self.positions = {}
        self.open_orders = {}
        self.order_status_updates = {}
        self.executions = []
        self._lock = threading.Lock()
        self._api_thread = None

    # === Connection Methods ===
    def start(self, timeout=10):
        """Connect and start message processing."""
        self.connect(self.host, self.port, self.client_id)

        self._api_thread = threading.Thread(target=self.run, daemon=True)
        self._api_thread.start()

        start = time.time()
        while not self.connected and time.time() - start < timeout:
            time.sleep(0.1)

        return self.connected

    def stop(self):
        """Disconnect from TWS."""
        if self.isConnected():
            self.disconnect()

    # === Connection Callbacks ===
    def connectAck(self):
        pass

    def nextValidId(self, orderId: int):
        self.next_order_id = orderId
        self.connected = True

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        # Info messages (not errors)
        if errorCode in [2104, 2106, 2158, 2119, 10349, 399]:
            pass  # Ignore info messages
        elif errorCode == 10285:
            pass  # API version warning - ignore
        else:
            print(f"[ERROR] {errorCode}: {errorString}", file=sys.stderr)

    # === Order Callbacks ===
    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice,
                   permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice):
        with self._lock:
            self.order_status_updates[orderId] = {
                'orderId': orderId,
                'status': status,
                'filled': float(filled),
                'remaining': float(remaining),
                'avgFillPrice': avgFillPrice,
                'lastFillPrice': lastFillPrice,
            }

    def openOrder(self, orderId, contract, order, orderState):
        with self._lock:
            self.open_orders[orderId] = {
                'orderId': orderId,
                'symbol': contract.symbol,
                'currency': contract.currency,
                'action': order.action,
                'quantity': float(order.totalQuantity),
                'orderType': order.orderType,
                'status': orderState.status,
            }

    def execDetails(self, reqId, contract, execution):
        with self._lock:
            self.executions.append({
                'execId': execution.execId,
                'symbol': contract.symbol,
                'currency': contract.currency,
                'side': execution.side,
                'shares': float(execution.shares),
                'price': execution.price,
                'time': execution.time,
            })

    # === Position Callbacks ===
    def position(self, account, contract, position, avgCost):
        key = f"{contract.symbol}/{contract.currency}"
        with self._lock:
            self.positions[key] = {
                'account': account,
                'symbol': contract.symbol,
                'currency': contract.currency,
                'position': float(position),
                'avgCost': avgCost,
            }

    def positionEnd(self):
        pass

    # === Helper Methods ===
    def _get_next_order_id(self):
        """Get and increment order ID."""
        oid = self.next_order_id
        self.next_order_id += 1
        return oid

    def _create_forex_contract(self, base: str, quote: str) -> Contract:
        """Create forex contract."""
        contract = Contract()
        contract.symbol = base
        contract.currency = quote
        contract.secType = "CASH"
        contract.exchange = "IDEALPRO"
        return contract

    def _round_price(self, price: float, quote: str) -> float:
        """Round price to valid tick size for the currency pair."""
        if quote == "JPY":
            # JPY pairs: tick size is 0.005 (half pip)
            return round(price * 200) / 200
        else:
            # Other pairs: tick size is 0.00005 (half pip)
            return round(price * 20000) / 20000

    def _create_order(self, action: str, quantity: float, order_type: str = "MKT",
                      limit_price: float = None, stop_price: float = None,
                      parent_id: int = None, transmit: bool = True) -> Order:
        """Create an order with proper attributes."""
        order = Order()
        order.action = action
        order.orderType = order_type
        order.totalQuantity = quantity
        order.transmit = transmit
        order.eTradeOnly = False
        order.firmQuoteOnly = False

        if limit_price is not None:
            order.lmtPrice = limit_price
        if stop_price is not None:
            order.auxPrice = stop_price
        if parent_id is not None:
            order.parentId = parent_id

        return order

    # === Public API ===
    def get_position(self, base: str, quote: str) -> dict:
        """Get current position for a currency pair."""
        self.positions.clear()
        self.reqPositions()
        time.sleep(1)

        key = f"{base}/{quote}"
        return self.positions.get(key, {'position': 0, 'avgCost': 0})

    def place_market_order(self, base: str, quote: str, action: str, quantity: float) -> dict:
        """
        Place a market order.

        Args:
            base: Base currency (e.g., "EUR")
            quote: Quote currency (e.g., "USD")
            action: "BUY" or "SELL"
            quantity: Order size

        Returns:
            dict with orderId and status
        """
        contract = self._create_forex_contract(base, quote)
        order = self._create_order(action, quantity, "MKT")
        order_id = self._get_next_order_id()

        self.placeOrder(order_id, contract, order)

        # Wait for fill
        timeout = 10
        start = time.time()
        while time.time() - start < timeout:
            time.sleep(0.2)
            status = self.order_status_updates.get(order_id, {})
            if status.get('status') == 'Filled':
                return {
                    'success': True,
                    'orderId': order_id,
                    'status': 'Filled',
                    'filled': status.get('filled', 0),
                    'avgPrice': status.get('avgFillPrice', 0),
                }

        return {
            'success': False,
            'orderId': order_id,
            'status': self.order_status_updates.get(order_id, {}).get('status', 'Unknown'),
            'error': 'Timeout waiting for fill'
        }

    def place_bracket_order(self, base: str, quote: str, action: str, quantity: float,
                           entry_price: float, take_profit: float, stop_loss: float) -> dict:
        """
        Place a bracket order (entry + TP + SL).

        The entry is a limit order, with attached take profit and stop loss orders
        that become active once the entry is filled.

        Args:
            base: Base currency
            quote: Quote currency
            action: "BUY" or "SELL" for entry
            quantity: Order size
            entry_price: Limit price for entry
            take_profit: Take profit price
            stop_loss: Stop loss price

        Returns:
            dict with order IDs and status
        """
        contract = self._create_forex_contract(base, quote)
        exit_action = "SELL" if action == "BUY" else "BUY"

        # Round prices to valid tick size
        entry_price = self._round_price(entry_price, quote)
        take_profit = self._round_price(take_profit, quote)
        stop_loss = self._round_price(stop_loss, quote)

        # Parent order (entry)
        parent_id = self._get_next_order_id()
        parent_order = self._create_order(action, quantity, "LMT",
                                          limit_price=entry_price, transmit=False)
        parent_order.orderId = parent_id

        # Take profit order
        tp_id = self._get_next_order_id()
        tp_order = self._create_order(exit_action, quantity, "LMT",
                                      limit_price=take_profit, parent_id=parent_id, transmit=False)
        tp_order.orderId = tp_id

        # Stop loss order
        sl_id = self._get_next_order_id()
        sl_order = self._create_order(exit_action, quantity, "STP",
                                      stop_price=stop_loss, parent_id=parent_id, transmit=True)
        sl_order.orderId = sl_id

        # Place all orders
        self.placeOrder(parent_id, contract, parent_order)
        self.placeOrder(tp_id, contract, tp_order)
        self.placeOrder(sl_id, contract, sl_order)

        time.sleep(1)

        return {
            'success': True,
            'entryOrderId': parent_id,
            'takeProfitOrderId': tp_id,
            'stopLossOrderId': sl_id,
            'entryPrice': entry_price,
            'takeProfit': take_profit,
            'stopLoss': stop_loss,
        }

    def place_market_entry_with_bracket(self, base: str, quote: str, action: str,
                                         quantity: float, take_profit: float,
                                         stop_loss: float) -> dict:
        """
        Place a market entry with attached TP and SL orders.

        This enters immediately at market, then attaches bracket orders.
        """
        contract = self._create_forex_contract(base, quote)
        exit_action = "SELL" if action == "BUY" else "BUY"

        # Round prices to valid tick size
        take_profit = self._round_price(take_profit, quote)
        stop_loss = self._round_price(stop_loss, quote)

        # Market entry
        entry_id = self._get_next_order_id()
        entry_order = self._create_order(action, quantity, "MKT", transmit=True)

        self.placeOrder(entry_id, contract, entry_order)

        # Wait for entry fill
        timeout = 10
        start = time.time()
        entry_filled = False
        fill_price = 0

        while time.time() - start < timeout:
            time.sleep(0.2)
            status = self.order_status_updates.get(entry_id, {})
            if status.get('status') == 'Filled':
                entry_filled = True
                fill_price = status.get('avgFillPrice', 0)
                break

        if not entry_filled:
            return {
                'success': False,
                'error': 'Entry order not filled',
                'entryOrderId': entry_id,
            }

        # Now place TP and SL as OCA (One Cancels All) group
        oca_group = f"OCA_{entry_id}_{int(time.time())}"

        # Take profit order
        tp_id = self._get_next_order_id()
        tp_order = self._create_order(exit_action, quantity, "LMT",
                                      limit_price=take_profit, transmit=False)
        tp_order.orderId = tp_id
        tp_order.ocaGroup = oca_group
        tp_order.ocaType = 1  # Cancel all remaining orders with block

        # Stop loss order
        sl_id = self._get_next_order_id()
        sl_order = self._create_order(exit_action, quantity, "STP",
                                      stop_price=stop_loss, transmit=True)
        sl_order.orderId = sl_id
        sl_order.ocaGroup = oca_group
        sl_order.ocaType = 1

        self.placeOrder(tp_id, contract, tp_order)
        self.placeOrder(sl_id, contract, sl_order)

        time.sleep(0.5)

        return {
            'success': True,
            'entryOrderId': entry_id,
            'entryPrice': fill_price,
            'takeProfitOrderId': tp_id,
            'stopLossOrderId': sl_id,
            'takeProfit': take_profit,
            'stopLoss': stop_loss,
        }

    def close_position(self, base: str, quote: str) -> dict:
        """Close entire position for a currency pair at market."""
        pos = self.get_position(base, quote)
        position_size = pos.get('position', 0)

        if position_size == 0:
            return {'success': True, 'message': 'No position to close'}

        action = "SELL" if position_size > 0 else "BUY"
        quantity = abs(position_size)

        return self.place_market_order(base, quote, action, quantity)

    def cancel_order(self, order_id: int) -> dict:
        """Cancel an open order."""
        self.cancelOrder(order_id)
        time.sleep(1)

        status = self.order_status_updates.get(order_id, {})
        return {
            'success': status.get('status') in ['Cancelled', 'PendingCancel'],
            'orderId': order_id,
            'status': status.get('status', 'Unknown'),
        }

    def cancel_all_orders(self) -> dict:
        """Cancel all open orders."""
        self.reqGlobalCancel()
        time.sleep(2)
        return {'success': True, 'message': 'Global cancel requested'}


def main():
    """CLI interface for order execution."""
    if len(sys.argv) < 2:
        print(json.dumps({
            'error': 'Usage: python ibkr_executor.py <command> [args]',
            'commands': [
                'position <BASE> <QUOTE>',
                'buy <BASE> <QUOTE> <QUANTITY>',
                'sell <BASE> <QUOTE> <QUANTITY>',
                'bracket <BASE> <QUOTE> <ACTION> <QTY> <ENTRY> <TP> <SL>',
                'market_bracket <BASE> <QUOTE> <ACTION> <QTY> <TP> <SL>',
                'close <BASE> <QUOTE>',
                'cancel <ORDER_ID>',
                'cancel_all',
            ]
        }))
        sys.exit(1)

    command = sys.argv[1].lower()

    # Connect
    executor = IBKRExecutor(port=7497, client_id=101)
    if not executor.start():
        print(json.dumps({'error': 'Failed to connect to TWS/IB Gateway'}))
        sys.exit(1)

    try:
        if command == 'position' and len(sys.argv) >= 4:
            base, quote = sys.argv[2], sys.argv[3]
            result = executor.get_position(base, quote)

        elif command == 'buy' and len(sys.argv) >= 5:
            base, quote, qty = sys.argv[2], sys.argv[3], float(sys.argv[4])
            result = executor.place_market_order(base, quote, "BUY", qty)

        elif command == 'sell' and len(sys.argv) >= 5:
            base, quote, qty = sys.argv[2], sys.argv[3], float(sys.argv[4])
            result = executor.place_market_order(base, quote, "SELL", qty)

        elif command == 'bracket' and len(sys.argv) >= 9:
            base, quote = sys.argv[2], sys.argv[3]
            action = sys.argv[4].upper()
            qty = float(sys.argv[5])
            entry = float(sys.argv[6])
            tp = float(sys.argv[7])
            sl = float(sys.argv[8])
            result = executor.place_bracket_order(base, quote, action, qty, entry, tp, sl)

        elif command == 'market_bracket' and len(sys.argv) >= 8:
            base, quote = sys.argv[2], sys.argv[3]
            action = sys.argv[4].upper()
            qty = float(sys.argv[5])
            tp = float(sys.argv[6])
            sl = float(sys.argv[7])
            result = executor.place_market_entry_with_bracket(base, quote, action, qty, tp, sl)

        elif command == 'close' and len(sys.argv) >= 4:
            base, quote = sys.argv[2], sys.argv[3]
            result = executor.close_position(base, quote)

        elif command == 'cancel' and len(sys.argv) >= 3:
            order_id = int(sys.argv[2])
            result = executor.cancel_order(order_id)

        elif command == 'cancel_all':
            result = executor.cancel_all_orders()

        else:
            result = {'error': f'Unknown command or missing arguments: {command}'}

        print(json.dumps(result))

    finally:
        executor.stop()


if __name__ == "__main__":
    main()
