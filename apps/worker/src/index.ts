import { setGlobalDispatcher, Agent as UndiciAgent } from "undici";
import { env } from "./env.js";
import { log } from "./log.js";

// Le dispatcher fetch par défaut de Node 20 (undici) ferme la connexion
// après 5 min sans byte reçu (bodyTimeout) et 5 min sans headers
// (headersTimeout). Pour des modèles LLM volumineux qui peuvent mettre
// plusieurs minutes à charger / générer, on désactive ces deadlines.
setGlobalDispatcher(
  new UndiciAgent({
    headersTimeout: 0,
    bodyTimeout: 0,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
  }),
);
import { startTuyaPoller } from "./pollers/tuya.js";
import { startTempoPoller } from "./pollers/tempo.js";
import { startShellyPoller } from "./pollers/shelly.js";
import { startEcoFlowMqtt, startEcoFlowPoller } from "./pollers/ecoflow.js";
import { startRollupScheduler } from "./jobs/rollup.js";
import { startRulesEngine } from "./rules/engine.js";
import { startFollowLoadLoop } from "./rules/follow-load.js";
import { startAgentScheduler } from "./agent/optimizer.js";
import { startSafetyLoop } from "./agent/safety.js";
import { startLoadDetection } from "./agent/loads.js";
import { startHttpServer } from "./server.js";

async function main() {
  log.info("worker starting", {
    pollIntervalS: env.POLL_INTERVAL_SECONDS,
  });

  startTuyaPoller(env.POLL_INTERVAL_SECONDS);
  startTempoPoller();
  startShellyPoller(env.POLL_INTERVAL_SECONDS);

  try {
    await startEcoFlowMqtt();
  } catch (e) {
    log.warn("ecoflow mqtt setup failed", { error: (e as Error).message });
  }

  // EcoFlow REST poll : l'API gratuite refuse souvent getQuotaAll sur
  // Delta Max (code 1006). On garde le tick mais sans bloquer si refusé.
  startEcoFlowPoller(env.POLL_INTERVAL_SECONDS);

  startRulesEngine(env.POLL_INTERVAL_SECONDS);
  startFollowLoadLoop(env.POLL_INTERVAL_SECONDS);
  startSafetyLoop(env.POLL_INTERVAL_SECONDS);
  startRollupScheduler();
  startLoadDetection();
  startAgentScheduler();
  startHttpServer();

  log.info("worker ready");
}

main().catch((e) => {
  log.error("worker fatal", { error: (e as Error).message });
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
