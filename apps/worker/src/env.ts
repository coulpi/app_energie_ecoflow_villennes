import { z } from "zod";

const Schema = z.object({
  DATABASE_URL: z.string().url(),
  ECOFLOW_ACCESS_KEY: z.string().min(1).optional(),
  ECOFLOW_SECRET_KEY: z.string().min(1).optional(),
  ECOFLOW_API_BASE: z.string().url().default("https://api-e.ecoflow.com"),
  TUYA_CLIENT_ID: z.string().min(1).optional(),
  TUYA_CLIENT_SECRET: z.string().min(1).optional(),
  TUYA_API_BASE: z.string().url().default("https://openapi.tuyaeu.com"),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  RAW_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  HOURLY_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  TZ: z.string().default("Europe/Paris"),
});

export const env = Schema.parse(process.env);
