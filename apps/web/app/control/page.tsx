import { redirect } from "next/navigation";

// Le pilotage (mode, bornes, réglages) est regroupé sur la page Batterie.
export default function ControlPage() {
  redirect("/battery");
}
