// Stand-in for the products' webhook endpoints during e2e runs: accepts every event.
import { createServer } from "node:http"

const port = Number(process.argv[2] ?? 4310)
createServer((req, res) => {
  req.resume()
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end('{"received":true}')
  })
}).listen(port, "127.0.0.1", () => console.log(`receiver on ${port}`))
