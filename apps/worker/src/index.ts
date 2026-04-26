import { env } from "./env.js";
import { log } from "./log.js";
import { startTuyaPoller } from "./pollers/tuya.js";
import { startEcoFlowMqtt } from "./pollers/ecoflow.js";
import { startRollupScheduler } from "./jobs/rollup.js";
import { startRulesEngine } from "./rules/engine.js";
import { startFollowLoadLoop } from "./rules/follow-load.js";

async function main() {
  log.info("worker starting", {
    pollIntervalS: env.POLL_INTERVAL_SECONDS,
  });

  startTuyaPoller(env.POLL_INTERVAL_SECONDS);

  try {
    await startEcoFlowMqtt();
  } catch (e) {
    log.warn("ecoflow mqtt setup failed", { error: (e as Error).message });
  }

  startRulesEngine(env.POLL_INTERVAL_SECONDS);
  startFollowLoadLoop(env.POLL_INTERVAL_SECONDS);
  startRollupScheduler();

  log.info("worker ready");
}

main().catch((e) => {
  log.error("worker fatal", { error: (e as Error).message });
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
