import { redirect } from "next/navigation";

// Rubrique Équipements : première page = jacuzzi (onglets via SubNav).
export default function EquipmentPage() {
  redirect("/jacuzzi");
}
