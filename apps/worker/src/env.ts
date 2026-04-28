import { z } from "zod";

const Schema = z.object({
  DATABASE_URL: z.string().url(),
  ECOFLOW_ACCESS_KEY: z.string().min(1).optional(),
  ECOFLOW_SECRET_KEY: z.string().min(1).optional(),
  ECOFLOW_API_BASE: z.string().url().default("https://api-e.ecoflow.com"),
  ECOFLOW_EMAIL: z.string().email().optional(),
  ECOFLOW_PASSWORD: z.string().min(1).optional(),
  TUYA_CLIENT_ID: z.string().min(1).optional(),
  TUYA_CLIENT_SECRET: z.string().min(1).optional(),
  TUYA_API_BASE: z.string().url().default("https://openapi.tuyaeu.com"),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  RAW_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  HOURLY_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  TZ: z.string().default("Europe/Paris"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("gemma4:31b"),
  AGENT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  AGENT_ENABLED: z.coerce.boolean().default(true),
  BATTERY_CRITICAL_SOC: z.coerce.number().min(0).max(100).default(5),
  HOME_LAT: z.coerce.number().default(48.9436),
  HOME_LON: z.coerce.number().default(1.993),
  HOME_TZ: z.string().default("Europe/Paris"),
  // APSystems : passerelle Zigbee custom (ESP8266+CC2530) qui republie
  // les onduleurs DS3 en MQTT. Optionnel : si APSYSTEMS_MQTT_URL est
  // vide, le poller ne démarre pas. APSYSTEMS_MOCK=1 active un
  // générateur de données simulées pour le dev.
  APSYSTEMS_MQTT_URL: z.string().optional(),
  APSYSTEMS_MQTT_USER: z.string().optional(),
  APSYSTEMS_MQTT_PASSWORD: z.string().optional(),
  APSYSTEMS_TOPIC_PREFIX: z.string().default("apsystems"),
  APSYSTEMS_MOCK: z.coerce.boolean().default(false),
  APSYSTEMS_MOCK_INTERVAL_S: z.coerce.number().int().positive().default(15),
});

export const env = Schema.parse(process.env);
