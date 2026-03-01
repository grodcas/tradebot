"""
Check IBKR account summary and P&L
"""

import threading
import time
from ibapi.client import EClient
from ibapi.wrapper import EWrapper


class AccountChecker(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected = False
        self.account_values = {}
        self.portfolio = []
        self.pnl_data = {}

    def connectAck(self):
        pass

    def nextValidId(self, orderId):
        self.connected = True
        print(f"Connected! Next order ID: {orderId}\n")

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        if errorCode not in [2104, 2106, 2158, 2119]:
            print(f"[{errorCode}] {errorString}")

    def accountSummary(self, reqId, account, tag, value, currency):
        self.account_values[tag] = {'value': value, 'currency': currency}

    def accountSummaryEnd(self, reqId):
        print("=" * 60)
        print("ACCOUNT SUMMARY")
        print("=" * 60)

        important_tags = [
            'NetLiquidation',
            'TotalCashValue',
            'UnrealizedPnL',
            'RealizedPnL',
            'AvailableFunds',
            'BuyingPower',
        ]

        for tag in important_tags:
            if tag in self.account_values:
                v = self.account_values[tag]
                print(f"{tag}: {v['value']} {v['currency']}")

        print()

    def updateAccountValue(self, key, value, currency, accountName):
        if key in ['RealizedPnL', 'UnrealizedPnL', 'NetLiquidation', 'TotalCashValue']:
            print(f"[ACCOUNT] {key}: {value} {currency}")

    def updatePortfolio(self, contract, position, marketPrice, marketValue,
                       averageCost, unrealizedPNL, realizedPNL, accountName):
        if position != 0:
            print(f"[PORTFOLIO] {contract.symbol}/{contract.currency}: "
                  f"Position={position}, AvgCost={averageCost:.5f}, "
                  f"MarketPrice={marketPrice:.5f}, "
                  f"UnrealizedPnL={unrealizedPNL:.2f}, RealizedPnL={realizedPNL:.2f}")

    def updateAccountTime(self, timeStamp):
        pass

    def accountDownloadEnd(self, accountName):
        print(f"\n[INFO] Account download complete for {accountName}")


def main():
    client = AccountChecker()

    print("Connecting to IBKR...")
    client.connect("127.0.0.1", 7497, 102)

    api_thread = threading.Thread(target=client.run, daemon=True)
    api_thread.start()

    timeout = 10
    start = time.time()
    while not client.connected and time.time() - start < timeout:
        time.sleep(0.1)

    if not client.connected:
        print("Failed to connect!")
        return

    time.sleep(1)

    # Request account summary
    print("\nRequesting account summary...")
    client.reqAccountSummary(
        9001,
        "All",
        "NetLiquidation,TotalCashValue,UnrealizedPnL,RealizedPnL,AvailableFunds,BuyingPower"
    )

    time.sleep(3)

    # Request account updates (includes portfolio)
    print("\nRequesting account updates (portfolio)...")
    # Get account ID from summary
    client.reqAccountUpdates(True, "")

    time.sleep(5)

    # Cancel subscriptions
    client.reqAccountUpdates(False, "")
    client.cancelAccountSummary(9001)

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)

    client.disconnect()


if __name__ == "__main__":
    main()
