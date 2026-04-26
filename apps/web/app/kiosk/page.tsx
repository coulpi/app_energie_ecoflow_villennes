import { getDashboardSnapshot } from "@/lib/snapshot";

// Page kiosk plein écran pensée pour un afficheur ESP32-S3 4 pouces (480×480
// ou 800×480). Auto-refresh par balise meta ; aucune dépendance JS.

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmt(v: number | null, unit: string) {
  return v === null ? "—" : `${Math.round(v)} ${unit}`;
}

export default async function KioskPage() {
  const s = await getDashboardSnapshot();
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="refresh" content="10" />
        <title>EcoFlow Kiosk</title>
        <style>{`
          html,body{margin:0;padding:0;background:#000;color:#fff;
            font-family: ui-sans-serif, system-ui, sans-serif;
            width:100vw;height:100vh;overflow:hidden;}
          .grid{display:grid;grid-template-columns:1fr 1fr;
            grid-template-rows:1fr 1fr;height:100%;gap:4px;}
          .cell{display:flex;flex-direction:column;justify-content:center;
            align-items:center;background:#0b0b0b;border:1px solid #1a1a1a;}
          .label{font-size:18px;letter-spacing:2px;color:#888;
            text-transform:uppercase;margin-bottom:4px;}
          .value{font-size:64px;font-weight:700;font-variant-numeric:tabular-nums;}
          .good{color:#10b981;} .warn{color:#f59e0b;} .bad{color:#ef4444;}
          .footer{position:fixed;bottom:4px;right:8px;font-size:11px;color:#444;}
        `}</style>
      </head>
      <body>
        <div className="grid">
          <div className="cell">
            <div className="label">Production</div>
            <div className="value good">{fmt(s.productionW, "W")}</div>
          </div>
          <div className="cell">
            <div className="label">Conso</div>
            <div className="value">{fmt(s.consumptionW, "W")}</div>
          </div>
          <div className="cell">
            <div className="label">Surplus</div>
            <div
              className={
                "value " +
                (s.surplusW === null
                  ? ""
                  : s.surplusW > 0
                    ? "good"
                    : "warn")
              }
            >
              {fmt(s.surplusW, "W")}
            </div>
          </div>
          <div className="cell">
            <div className="label">Batterie</div>
            <div
              className={
                "value " +
                (s.batterySoc === null
                  ? ""
                  : s.batterySoc < 20
                    ? "bad"
                    : s.batterySoc > 80
                      ? "good"
                      : "")
              }
            >
              {fmt(s.batterySoc, "%")}
            </div>
          </div>
        </div>
        <div className="footer">
          {s.switchOn ? "AC ON" : "AC OFF"} · {s.controlMode} ·{" "}
          {new Date(s.ts).toLocaleTimeString("fr-FR")}
        </div>
      </body>
    </html>
  );
}
