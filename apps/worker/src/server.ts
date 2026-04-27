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
import {
  publishEcoFlowSet,
  publishEcoFlowRawTopic,
  getEcoFlowPrivateMqtt,
  getRecentEcoFlowMessages,
} from "./pollers/ecoflow.js";
import { getFollowLoadState } from "./rules/follow-load.js";
import { prisma } from "./db.js";

const PORT = 3100;

export function startHttpServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "x"}`);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (req.method === "GET" && url.pathname === "/follow-load/state") {
        const state = getFollowLoadState();
        const ctrl = (await prisma.controlState.findUnique({
          where: { key: "default" },
        })) as
          | {
              chargeDeficitTimeoutMin?: number;
              chargeOffToOnLockMin?: number;
              chargeMinW?: number;
            }
          | null;
        const now = Date.now();
        const deficitTimeoutMs = (ctrl?.chargeDeficitTimeoutMin ?? 10) * 60_000;
        const offToOnLockMs = (ctrl?.chargeOffToOnLockMin ?? 5) * 60_000;
        const deficitElapsedMs =
          state.deficitStartedAtMs !== null ? now - state.deficitStartedAtMs : null;
        const deficitRemainingMs =
          deficitElapsedMs !== null
            ? Math.max(0, deficitTimeoutMs - deficitElapsedMs)
            : null;
        const offLockElapsedMs =
          state.lastOffAtMs !== null ? now - state.lastOffAtMs : null;
        const offLockRemainingMs =
          offLockElapsedMs !== null
            ? Math.max(0, offToOnLockMs - offLockElapsedMs)
            : null;
        res.writeHead(200);
        res.end(
          JSON.stringify({
            switchOn: state.switchOn,
            chargeW: state.chargeW,
            dischargeW: state.dischargeW,
            deficit: {
              active: deficitElapsedMs !== null,
              elapsedMs: deficitElapsedMs,
              remainingMs: deficitRemainingMs,
              timeoutMs: deficitTimeoutMs,
            },
            offLock: {
              active:
                offLockRemainingMs !== null && offLockRemainingMs > 0,
              elapsedMs: offLockElapsedMs,
              remainingMs: offLockRemainingMs,
              timeoutMs: offToOnLockMs,
            },
          }),
        );
        return;
      }

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

      if (req.method === "GET" && url.pathname === "/ecoflow/status") {
        const ctx = getEcoFlowPrivateMqtt();
        res.writeHead(200);
        res.end(
          JSON.stringify({
            privateMqttConnected: ctx !== null,
            userId: ctx?.userId ?? null,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/ecoflow/recent") {
        const n = Number(url.searchParams.get("n") ?? 20);
        res.writeHead(200);
        res.end(JSON.stringify({ messages: getRecentEcoFlowMessages(n) }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/ecoflow/rest-set") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          sn: string;
          moduleType: number;
          operateType: string;
          params: Record<string, unknown>;
        };
        const { getEcoFlowClient } = await import("./pollers/ecoflow.js");
        try {
          const result = await getEcoFlowClient().setProperty(
            body.sn,
            body.moduleType,
            body.operateType,
            body.params ?? {},
          );
          log.info("ecoflow rest-set ok", { ...body, result });
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, result }));
        } catch (e) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/ecoflow/raw") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          topic: string;
          payload: unknown;
        };
        if (!body.topic) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "topic requis" }));
          return;
        }
        await publishEcoFlowRawTopic(body.topic, body.payload);
        log.info("ecoflow raw published", { topic: body.topic });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/ecoflow/cmd") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          sn: string;
          moduleType: number;
          operateType: string;
          params: Record<string, unknown>;
        };
        if (!body.sn || typeof body.moduleType !== "number" || !body.operateType) {
          res.writeHead(400);
          res.end(
            JSON.stringify({
              error: "champs requis : sn, moduleType (number), operateType, params",
            }),
          );
          return;
        }
        await publishEcoFlowSet(body.sn, {
          moduleType: body.moduleType,
          operateType: body.operateType,
          params: body.params ?? {},
        });
        log.info("ecoflow cmd published", body);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/run") {
        const dryRun = url.searchParams.get("dryRun") === "1";
        const result = await runAgent(dryRun ? "demo" : "manual", { dryRun });
        res.writeHead(200);
        res.end(
          JSON.stringify({
            id: result.id.toString(),
            applied: result.applied,
            dryRun,
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
