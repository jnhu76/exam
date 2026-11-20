import http from "node:http";
import net from "node:net";

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const signal = req.socket; // placeholder
    const log = (t) =>
      console.log(
        `[srv] ${t} req.destroyed=${req.destroyed} sock.destroyed=${req.socket.destroyed} rawCloseListeners=${req.listenerCount("close")}`,
      );
    log("body-end");
    // mimic fastify: AbortController wired to raw 'close'
    const ac = new AbortController();
    req.on("close", () => {
      if (!ac.signal.aborted) ac.abort();
    });
    ac.signal.addEventListener("abort", () =>
      console.log("[srv] SIGNAL ABORTED"),
    );
    req.socket.on("close", () => console.log("[srv] SOCKET CLOSED"));
    setTimeout(() => {
      log("after-1s-wait");
      res.end("ok");
    }, 1000);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// Client 1: send full request, keep connection open, wait for response
const sock1 = net.connect(port, "127.0.0.1", () => {
  sock1.write(`POST /x HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\n\r\nhello`);
});
sock1.on("data", (d) => {
  console.log("[cli1] got response");
  sock1.end();
});
setTimeout(() => {
  // Client 2: send full request, then destroy socket mid-wait
  const sock2 = net.connect(port, "127.0.0.1", () => {
    sock2.write(
      `POST /x HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\n\r\nhello`,
    );
    setTimeout(() => {
      console.log("[cli2] destroying");
      sock2.destroy();
    }, 200);
  });
}, 300);
setTimeout(() => process.exit(0), 2500);
