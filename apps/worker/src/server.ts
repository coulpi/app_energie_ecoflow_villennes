// Tiny HTTP server pour permettre à l'UI Next.js de :
//   - déclencher manuellement un run de l'agent (POST /run),
//   - lister les modèles Ollama disponibles (GET /models).
// Pas d'auth : l'API n'est exposée que sur le réseau Docker interne.

import http from "node:http";
import { ollama as ollamaNs } from "@app/shared";
import { env } from "./env.js";
import { log } from "./log.js";
import { runAgent } from "./agent/optimizer.js";
import { detectLoadsOnce } from "./agent/loads.js";

const PORT = 3100;

export function startHttpServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "x"}`);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/models") {
        const models = await ollamaNs.ollamaListModels(env.OLLAMA_BASE_URL);
        res.writeHead(200);
        res.end(JSON.stringify({ models }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/detect-loads") {
        await detectLoadsOnce();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/run") {
        const result = await runAgent("manual");
        res.writeHead(200);
        res.end(
          JSON.stringify({
            id: result.id.toString(),
            applied: result.applied,
            error: result.error,
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
    } catch (e) {
      log.error("http server error", { error: (e as Error).message });
      res.writeHead(500);
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  server.listen(PORT, () => {
    log.info("http server listening", { port: PORT });
  });
  return server;
}
