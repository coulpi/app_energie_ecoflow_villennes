import { redirect } from "next/navigation";

// Rubrique Paramètres : première page = appareils (onglets via SubNav).
export default function SettingsPage() {
  redirect("/devices");
}
