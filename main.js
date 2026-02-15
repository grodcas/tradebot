const IB = require("ib");

const ib = new IB({
  clientId: 1,
  host: "127.0.0.1",
  port: 4002, // 7497 paper | 7496 live
});

ib.on("connected", () => {
  console.log("Connected to IBKR TWS");
  ib.reqCurrentTime();
});

ib.on("currentTime", (time) => {
  console.log("Server time:", new Date(time * 1000));
  ib.disconnect();
});

ib.on("error", (err) => {
  if (err.message.includes("connection is OK")) return;
  console.error("Real error:", err);
});


ib.connect();
