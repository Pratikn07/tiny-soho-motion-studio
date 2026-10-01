import { createServer } from "node:http";

import { healthPayload } from "./health.js";
import { createProviderRegistry } from "./providers/index.js";
import { createWorkerClient, runWorkerTick, skippedWork, workerConfig } from "./worker.js";

const port = Number(process.env.PORT ?? "8080");
const config = workerConfig();
let ticking = false;

if (config) {
  for (const reason of skippedWork(config)) console.warn(`creative-worker: ${reason}`);
  const client = createWorkerClient(config);
  const registry = createProviderRegistry();
  console.info(`creative-worker: video providers ${Object.keys(registry).join(", ") || "none"} registered.`);
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runWorkerTick(config, client, registry);
    } catch {
      // Failures are retained on the job by the processing path where possible.
    } finally {
      ticking = false;
    }
  };
  void tick();
  setInterval(() => void tick(), 1_000);
}

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(healthPayload(Boolean(config))));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
}).listen(port, "0.0.0.0");
