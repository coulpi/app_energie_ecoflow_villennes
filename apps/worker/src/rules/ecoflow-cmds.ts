// Mapping des commandes EcoFlow par modèle.
//
// Les `cmdCode` et la forme exacte de `params` varient entre Delta 2 / Delta Pro /
// River 2. On regroupe ici la logique pour pouvoir étendre le support facilement.
// Le modèle se déduit de `device.vendorMeta.model`.

import type { Device } from "@prisma/client";

interface CmdSpec {
  cmdCode: string;
  params: Record<string, unknown>;
}

function model(d: Device): string {
  const m = (d.vendorMeta as { model?: string } | null)?.model ?? "DELTA_2";
  return m.toUpperCase();
}

export const ECOFLOW_CMDS = {
  setChargeWatts(d: Device, watts: number): CmdSpec {
    switch (model(d)) {
      case "DELTA_PRO":
        return {
          cmdCode: "WN511_SET_AC_INCHARGE_SPEED_PACK",
          params: { chgWatts: Math.round(watts), chgPauseFlag: 0 },
        };
      case "DELTA_2":
      default:
        return {
          cmdCode: "MPPT_SET_CHARGE_INPUT_LIMIT",
          params: { chgWatts: Math.round(watts) },
        };
    }
  },
  setDischargeWatts(d: Device, watts: number): CmdSpec {
    // Sur EcoFlow on ne fixe pas une décharge "globale" mais on peut
    // limiter la puissance AC totale autorisée en sortie.
    switch (model(d)) {
      case "DELTA_PRO":
        return {
          cmdCode: "WN511_SET_AC_OUT_PWR_PACK",
          params: { outWatts: Math.round(watts) },
        };
      case "DELTA_2":
      default:
        return {
          cmdCode: "AC_OUT_LIMIT_SET",
          params: { outWatts: Math.round(watts) },
        };
    }
  },
  setMaxChargeSoc(_d: Device, soc: number): CmdSpec {
    return {
      cmdCode: "WN511_SET_CHG_HIGH_SOC",
      params: { socMaxLimit: Math.round(soc) },
    };
  },
  setMinDischargeSoc(_d: Device, soc: number): CmdSpec {
    return {
      cmdCode: "WN511_SET_DSG_LOW_SOC",
      params: { socMinLimit: Math.round(soc) },
    };
  },
  setOutputAc(_d: Device, on: boolean): CmdSpec {
    return {
      cmdCode: "WN511_SET_AC_OUT",
      params: { enabled: on ? 1 : 0 },
    };
  },
};
