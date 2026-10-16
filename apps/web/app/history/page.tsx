import Link from "next/link";
import { isNetwork2 } from "@/lib/networks";
import { prisma } from "@/lib/prisma";
import HistoryChart, { type HistoryPoint, type NetFilter } from "./HistoryChart";
import AppliancesChart, { type AppliancePoint } from "./AppliancesChart";
import AppliancesHourlyChart, {
  type ApplianceHourlyPoint,
  type DayBoundary,
} from "./AppliancesHourlyChart";

export const dynamic = "force-dynamic";

function fmtLabel(d: Date): string {
  const dd = d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Paris",
  });
  const hh = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    timeZone: "Europe/Paris",
  });
  return `${dd} ${hh}`;
}

function dayKey(d: Date): string {
  // Clé jour locale Europe/Paris : "2026-04-29"
  return d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

function dayLabel(key: string): string {
  // "2026-04-29" -> "29/04"
  const [, mm, dd] = key.split("-");
  return `${dd}/${mm}`;
}

// Réseau d'un appareil (même table que lib/dashboard.ts) ; null = batterie,
// rattachée aux deux (charge par le réseau 2, décharge vers le réseau 1).
const ROLE_NETWORK: Record<string, 1 | 2 | null> = {
  GRID_METER: 1,
  CONSUMPTION_METER: 1,
  PRODUCTION_METER: 1,
  SOLAR_INVERTER: 1,
  POWERSTREAM: 1,
  AUX_NETWORK_METER: 2,
  BATTERY_AC_SWITCH: 2,
  BATTERY: null,
};
const networkOf = (d: { role: string; name: string }): 1 | 2 | null =>
  d.role === "APPLIANCE" ? (isNetwork2(d.name) ? 2 : 1) : (ROLE_NETWORK[d.role] ?? null);

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ n?: string }>;
}) {
  const { n } = await searchParams;
  const net: NetFilter = n === "1" || n === "2" ? n : "all";
  const inNet = (k: 1 | 2 | null) => net === "all" || (k !== null && String(k) === net);

  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await prisma.readingHourly.findMany({
    where: { hourTs: { gte: since } },
    include: { device: true },
    orderBy: [{ hourTs: "asc" }],
  });

  // Agrégation par heure, par réseau (même bilan que le tableau de bord et
  // les coûts) :
  //   réseau 1 = solaire autoconsommé + décharge batterie + achat réseau 1
  //   réseau 2 = compteur du réseau 2 (piscine, jacuzzi, PAC, voiture).
  // NB : on n'additionne plus les consoWh de toutes les prises — la prise
  // jacuzzi et la prise AC batterie sont sur le réseau 2 et gonflaient la
  // conso « maison ».
  interface Slot {
    ts: Date;
    prod: number;
    imp1: number;
    exp1: number;
    dsg: number;
    conso2: number;
    socSum: number;
    socCount: number;
  }
  const byHour = new Map<string, Slot>();
  for (const r of rows) {
    const key = r.hourTs.toISOString();
    const slot = byHour.get(key) ?? {
      ts: r.hourTs,
      prod: 0,
      imp1: 0,
      exp1: 0,
      dsg: 0,
      conso2: 0,
      socSum: 0,
      socCount: 0,
    };
    const avg = r.avgPowerW;
    switch (r.device.role) {
      case "PRODUCTION_METER":
        slot.prod += r.prodWh ?? 0;
        break;
      case "GRID_METER":
        // Heures antérieures à importWh/exportWh : moyenne nette signée.
        slot.imp1 += r.importWh ?? (avg !== null ? Math.max(0, avg) : 0);
        slot.exp1 += r.exportWh ?? (avg !== null ? Math.max(0, -avg) : 0);
        break;
      case "BATTERY":
        // powerW batterie : + = décharge vers la maison (PowerStream).
        if (avg !== null) slot.dsg += Math.max(0, avg);
        break;
      case "AUX_NETWORK_METER":
        slot.conso2 += r.consoWh ?? r.importWh ?? (avg !== null ? Math.max(0, avg) : 0);
        break;
    }
    if (r.minSoc !== null && r.maxSoc !== null) {
      slot.socSum += (r.minSoc + r.maxSoc) / 2;
      slot.socCount += 1;
    }
    byHour.set(key, slot);
  }

  const points: HistoryPoint[] = Array.from(byHour.values())
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((s) => ({
      ts: s.ts.toISOString(),
      label: fmtLabel(s.ts),
      prodWh: Math.round(s.prod),
      conso1Wh: Math.round(Math.max(0, s.prod - s.exp1) + s.dsg + s.imp1),
      import1Wh: Math.round(s.imp1),
      conso2Wh: Math.round(s.conso2),
      soc: s.socCount > 0 ? Math.round(s.socSum / s.socCount) : null,
    }));

  // Bilans 7 jours (selon le filtre)
  const sum = (k: keyof HistoryPoint) => points.reduce((acc, p) => acc + ((p[k] as number) ?? 0), 0);
  const totals: Array<{ label: string; wh: number; cls: string }> =
    net === "2"
      ? [{ label: "Consommé réseau 2", wh: sum("conso2Wh"), cls: "text-cyan-300" }]
      : net === "1"
        ? [
            { label: "Produit", wh: sum("prodWh"), cls: "text-amber-300" },
            { label: "Consommé réseau 1", wh: sum("conso1Wh"), cls: "text-emerald-300" },
            { label: "Acheté réseau 1", wh: sum("import1Wh"), cls: "text-rose-300" },
          ]
        : [
            { label: "Produit", wh: sum("prodWh"), cls: "text-amber-300" },
            { label: "Réseau 1", wh: sum("conso1Wh"), cls: "text-emerald-300" },
            { label: "Réseau 2", wh: sum("conso2Wh"), cls: "text-cyan-300" },
          ];

  // ── Conso par équipement (7 jours) ─────────────────────────────────
  // Sources combinées :
  //  (a) ReadingHourly des devices APPLIANCE / BATTERY_AC_SWITCH (mesure
  //      directe — jacuzzi, voiture, prise charge batterie, réseau
  //      piscine/jacuzzi…).
  //  (b) LoadProfile sans device lié (PAC) : énergie estimée depuis les
  //      LoadEvent (durée × puissance moyenne du cycle).
  const measuredDevices = (
    await prisma.device.findMany({
      where: {
        enabled: true,
        role: {
          in: ["APPLIANCE", "BATTERY_AC_SWITCH", "AUX_NETWORK_METER"] as never,
        },
      },
      orderBy: { name: "asc" },
    })
  ).filter((d) => inNet(networkOf(d)));
  const measuredHourly = measuredDevices.length
    ? await prisma.readingHourly.findMany({
        where: {
          deviceId: { in: measuredDevices.map((d) => d.id) },
          hourTs: { gte: since },
          consoWh: { not: null },
        },
        select: { deviceId: true, hourTs: true, consoWh: true },
      })
    : [];
  const heuristicProfiles = (
    await prisma.loadProfile.findMany({
      where: { enabled: true, measuredDeviceId: null },
      orderBy: { createdAt: "asc" },
    })
  ).filter((p) => inNet(isNetwork2(`${p.id} ${p.name}`) ? 2 : 1));
  const heuristicEvents = heuristicProfiles.length
    ? await prisma.loadEvent.findMany({
        where: {
          profileId: { in: heuristicProfiles.map((p) => p.id) },
          startTs: { gte: since },
        },
        select: {
          profileId: true,
          startTs: true,
          durationMin: true,
          avgPowerW: true,
          energyWh: true,
        },
      })
    : [];

  // Initialise un point par jour glissant (7 derniers jours).
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    dayKeys.push(dayKey(d));
  }
  const deviceNames: string[] = [
    ...measuredDevices.map((d) => d.name),
    ...heuristicProfiles.map((p) => `${p.name} (estimé)`),
  ];
  const buckets = new Map<string, Record<string, number>>();
  for (const k of dayKeys) {
    const row: Record<string, number> = {};
    for (const n of deviceNames) row[n] = 0;
    buckets.set(k, row);
  }
  // (a) mesurés : agrège consoWh par jour.
  const deviceById = new Map(measuredDevices.map((d) => [d.id, d]));
  for (const r of measuredHourly) {
    const k = dayKey(r.hourTs);
    const row = buckets.get(k);
    if (!row) continue;
    const dev = deviceById.get(r.deviceId);
    if (!dev) continue;
    row[dev.name] = (row[dev.name] ?? 0) + (r.consoWh ?? 0);
  }
  // (b) heuristiques : énergie depuis LoadEvent (privilégie energyWh
  // si présent, sinon durationMin × avgPowerW / 60).
  const profileById = new Map(heuristicProfiles.map((p) => [p.id, p]));
  for (const e of heuristicEvents) {
    const k = dayKey(e.startTs);
    const row = buckets.get(k);
    if (!row) continue;
    const p = profileById.get(e.profileId);
    if (!p) continue;
    const wh =
      e.energyWh ??
      (e.avgPowerW !== null ? (e.durationMin * e.avgPowerW) / 60 : 0);
    const key = `${p.name} (estimé)`;
    row[key] = (row[key] ?? 0) + wh;
  }

  const appliancePoints: AppliancePoint[] = dayKeys.map((k) => ({
    label: dayLabel(k),
    ...(buckets.get(k) ?? {}),
  }));
  // Ne garde que les devices qui ont au moins une valeur > 0 sur la fenêtre
  // (évite d'afficher des barres vides pour des appareils non connus).
  const usedDeviceNames = deviceNames.filter((n) =>
    appliancePoints.some((pt) => (pt[n] as number) > 0),
  );

  // ── Courbe horaire (48h) par équipement ────────────────────────────
  const since48h = new Date(Date.now() - 48 * 3_600_000);
  const hourlyMeasured = measuredDevices.length
    ? await prisma.readingHourly.findMany({
        where: {
          deviceId: { in: measuredDevices.map((d) => d.id) },
          hourTs: { gte: since48h },
        },
        select: { deviceId: true, hourTs: true, avgPowerW: true },
        orderBy: { hourTs: "asc" },
      })
    : [];
  // 48 buckets horaires alignés sur l'heure courante.
  // `label` doit être UNIQUE par bucket (sinon ReferenceLine x=label ne
  // sait pas a quel point se rattacher quand 00 h apparait deux fois).
  // L'axe X formate uniquement l'heure via tickFormatter.
  const hourKeys: { ts: Date; key: string; label: string; hourLabel: string }[] = [];
  for (let i = 47; i >= 0; i--) {
    const d = new Date(Date.now() - i * 3_600_000);
    d.setMinutes(0, 0, 0);
    hourKeys.push({
      ts: d,
      key: d.toISOString(),
      label: d.toISOString(),
      hourLabel: d.toLocaleTimeString("fr-FR", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
      }),
    });
  }
  const hourBuckets = new Map<string, Record<string, number>>();
  for (const h of hourKeys) {
    const row: Record<string, number> = {};
    for (const d of measuredDevices) row[d.name] = 0;
    for (const p of heuristicProfiles) row[`${p.name} (estimé)`] = 0;
    hourBuckets.set(h.key, row);
  }
  for (const r of hourlyMeasured) {
    const k = new Date(r.hourTs);
    k.setMinutes(0, 0, 0);
    const row = hourBuckets.get(k.toISOString());
    if (!row) continue;
    const dev = deviceById.get(r.deviceId);
    if (!dev) continue;
    row[dev.name] = r.avgPowerW ?? 0;
  }
  // Pour les heuristiques : on étale chaque LoadEvent sur ses heures
  // chevauchées (pondération par durée dans le bucket horaire).
  for (const e of heuristicEvents) {
    const p = profileById.get(e.profileId);
    if (!p) continue;
    const startMs = e.startTs.getTime();
    const endMs = startMs + e.durationMin * 60_000;
    const power = e.avgPowerW ?? p.expectedPowerW;
    for (const h of hourKeys) {
      const hStart = h.ts.getTime();
      const hEnd = hStart + 3_600_000;
      const overlap = Math.max(0, Math.min(endMs, hEnd) - Math.max(startMs, hStart));
      if (overlap === 0) continue;
      const ratio = overlap / 3_600_000;
      const row = hourBuckets.get(h.key);
      if (!row) continue;
      const key = `${p.name} (estimé)`;
      row[key] = (row[key] ?? 0) + power * ratio;
    }
  }
  const hourlyPoints: ApplianceHourlyPoint[] = hourKeys.map((h) => ({
    label: h.label,
    hourLabel: h.hourLabel,
    ...(hourBuckets.get(h.key) ?? {}),
  }));
  const usedHourlyNames = deviceNames.filter((n) =>
    hourlyPoints.some((pt) => (pt[n] as number) > 0),
  );
  // Frontières de jour (minuit Europe/Paris) sur la fenêtre 48h.
  // L'axe X utilise l'étiquette "HH" (00 h, 01 h…) — on récupère donc
  // les points dont l'heure locale est 00 h, et on associe la date.
  const hourlyDayBoundaries: DayBoundary[] = hourKeys
    .filter((h) => {
      const lh = h.ts.toLocaleTimeString("fr-FR", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
      });
      return lh.startsWith("00");
    })
    .map((h) => ({
      label: h.label,
      dateLabel: h.ts.toLocaleDateString("fr-FR", {
        timeZone: "Europe/Paris",
        day: "2-digit",
        month: "2-digit",
      }),
    }));

  // Lignes du tableau : 200 dernières
  const lastRows = rows
    .filter((r) => inNet(networkOf(r.device)))
    .sort((a, b) => b.hourTs.getTime() - a.hourTs.getTime())
    .slice(0, 200);

  return (
    <div className="space-y-5 sm:space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="page-h1">Historique</h1>
          <p className="page-sub mt-1">
            Agrégats horaires sur les 7 derniers jours.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
          {totals.map((t) => (
            <span key={t.label}>
              {t.label}{" "}
              <span className={`${t.cls} font-semibold tabular-nums`}>
                {(t.wh / 1000).toFixed(1)} kWh
              </span>
            </span>
          ))}
        </div>
      </div>

      <Seg
        options={[
          { key: "all", label: "Tous réseaux", href: "/history" },
          { key: "1", label: "Réseau 1 · maison", href: "/history?n=1" },
          { key: "2", label: "Réseau 2 · piscine, jacuzzi, PAC, voiture", href: "/history?n=2" },
        ]}
        active={net}
      />

      {points.length === 0 ? (
        <div className="card text-sm text-zinc-500">
          Aucune donnée agrégée pour la période. Les agrégats horaires sont
          calculés par le worker.
        </div>
      ) : (
        <HistoryChart data={points} net={net} />
      )}

      {usedDeviceNames.length > 0 && (
        <AppliancesChart
          data={appliancePoints}
          deviceNames={usedDeviceNames}
        />
      )}

      {usedHourlyNames.length > 0 && (
        <AppliancesHourlyChart
          data={hourlyPoints}
          deviceNames={usedHourlyNames}
          dayBoundaries={hourlyDayBoundaries}
        />
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          Dernières lignes par équipement
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm w-full min-w-[640px]">
            <thead className="text-zinc-400 bg-white/[0.02]">
              <tr>
                <th className="text-left p-3 font-medium">Heure</th>
                <th className="text-left p-3 font-medium">Équipement</th>
                <th className="text-right p-3 font-medium">Moy. W</th>
                <th className="text-right p-3 font-medium">Prod Wh</th>
                <th className="text-right p-3 font-medium">Conso Wh</th>
                <th className="text-right p-3 font-medium">SoC min/max</th>
              </tr>
            </thead>
            <tbody>
              {lastRows.map((r) => (
                <tr
                  key={r.id.toString()}
                  className="border-t border-white/[0.05] hover:bg-white/[0.02]"
                >
                  <td className="p-3 font-mono text-xs whitespace-nowrap">
                    {r.hourTs.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="p-3">{r.device.name}</td>
                  <td className="p-3 text-right tabular-nums">
                    {r.avgPowerW?.toFixed(0) ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums text-emerald-300">
                    {r.prodWh?.toFixed(0) ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums text-sky-300">
                    {r.consoWh?.toFixed(0) ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {r.minSoc !== null && r.maxSoc !== null
                      ? `${r.minSoc.toFixed(0)} / ${r.maxSoc.toFixed(0)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Seg({
  options,
  active,
}: {
  options: Array<{ key: string; label: string; href: string }>;
  active: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          className={
            "btn text-xs " +
            (o.key === active
              ? "bg-emerald-900/50 text-emerald-100 border border-emerald-700"
              : "btn-ghost")
          }
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
