// Mapping des commandes EcoFlow par modèle, format MQTT privé.
//
// Le canal MQTT privé (cf. ecoflow-private.ts) utilise :
//   { moduleType, operateType, params }
// publié sur /app/{userId}/{sn}/thing/property/set.
//
// Format validé pour Delta Max via le projet tolwi/hassio-ecoflow-cloud
// (custom_components/ecoflow_cloud/devices/internal/delta_max.py).

import type { Device } from "@prisma/client";

interface PrivateCmdSpec {
  moduleType: number;
  operateType: string;
  params: Record<string, unknown>;
}

function model(d: Device): string {
  const m = (d.vendorMeta as { model?: string } | null)?.model ?? "DELTA_MAX";
  return m.toUpperCase();
}

export const ECOFLOW_CMDS = {
  /** Puissance AC max de charge (slowChgPower). Bornes : 100..2000 W. */
  setChargeWatts(d: Device, watts: number): PrivateCmdSpec {
    const w = Math.max(100, Math.min(2000, Math.round(watts)));
    switch (model(d)) {
      case "DELTA_MAX":
      case "DELTA_2":
      default:
        return {
          moduleType: 0,
          operateType: "TCP",
          params: { id: 69, slowChgPower: w },
        };
    }
  },
  /**
   * Sur Delta Max, on n'a pas de "discharge limit" via privé : la sortie
   * AC est juste ON/OFF (cfgAcEnabled, id 66). On expose donc setOutputAc.
   * setDischargeWatts est laissé en place pour les modèles qui le supportent.
   */
  setDischargeWatts(_d: Device, _watts: number): PrivateCmdSpec | null {
    return null;
  },
  setMaxChargeSoc(_d: Device, soc: number): PrivateCmdSpec {
    return {
      moduleType: 2,
      operateType: "TCP",
      params: { id: 49, maxChgSoc: Math.round(soc) },
    };
  },
  setMinDischargeSoc(_d: Device, soc: number): PrivateCmdSpec {
    return {
      moduleType: 2,
      operateType: "TCP",
      params: { id: 51, minDsgSoc: Math.round(soc) },
    };
  },
  setOutputAc(_d: Device, on: boolean): PrivateCmdSpec {
    return {
      moduleType: 0,
      operateType: "TCP",
      params: { id: 66, enabled: on ? 1 : 0 },
    };
  },
};
