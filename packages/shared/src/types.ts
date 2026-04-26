import { z } from "zod";

export const DeviceTypeSchema = z.enum([
  "TUYA_METER",
  "TUYA_SWITCH",
  "ECOFLOW_BATTERY",
  "SHELLY_METER",
]);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;

export const DeviceRoleSchema = z.enum([
  "PRODUCTION_METER",
  "CONSUMPTION_METER",
  "GRID_METER",
  "BATTERY_AC_SWITCH",
  "BATTERY",
]);
export type DeviceRole = z.infer<typeof DeviceRoleSchema>;

export const ReadingSchema = z.object({
  deviceId: z.string(),
  ts: z.date(),
  powerW: z.number().nullable().optional(),
  energyWh: z.number().nullable().optional(),
  soc: z.number().nullable().optional(),
  switchOn: z.boolean().nullable().optional(),
  raw: z.unknown().optional(),
});
export type Reading = z.infer<typeof ReadingSchema>;

export const ControlModeSchema = z.enum([
  "MANUAL",
  "RULES",
  "FOLLOW_LOAD",
  "OFF",
]);
export type ControlMode = z.infer<typeof ControlModeSchema>;
