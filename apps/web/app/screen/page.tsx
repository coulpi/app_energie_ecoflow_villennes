import ScreenMirror from "./ScreenMirror";

export const dynamic = "force-dynamic";

export default function ScreenPage() {
  return (
    <div className="space-y-5 sm:space-y-6 max-w-[1100px] mx-auto">
      <div>
        <h1 className="page-h1">Écran</h1>
        <p className="page-sub mt-1">
          Réplique en direct de l&rsquo;écran ESPHome tabscreen1 (480 × 480) : mêmes données
          et mêmes pages que sur l&rsquo;appareil.
        </p>
      </div>
      <ScreenMirror />
    </div>
  );
}
