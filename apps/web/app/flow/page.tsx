import { redirect } from "next/navigation";

// Le schéma de flux est désormais sur le tableau de bord.
export default function FlowPage() {
  redirect("/");
}
