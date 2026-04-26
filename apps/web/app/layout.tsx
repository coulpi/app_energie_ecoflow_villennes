import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "EcoFlow Villennes",
  description: "Pilotage énergétique EcoFlow + Tuya",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className="dark">
      <body className="min-h-screen bg-[#0a0e1a] text-zinc-100 antialiased">
        <div className="flex">
          <Sidebar />
          <main className="flex-1 min-h-screen p-6 sm:p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
