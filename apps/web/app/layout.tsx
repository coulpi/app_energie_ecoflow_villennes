import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

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
      <body className="min-h-screen">
        <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-6">
          <Link href="/" className="font-semibold">⚡ EcoFlow Villennes</Link>
          <nav className="flex gap-4 text-sm text-zinc-400">
            <Link href="/" className="hover:text-zinc-100">Tableau de bord</Link>
            <Link href="/flow" className="hover:text-zinc-100">Flux</Link>
            <Link href="/devices" className="hover:text-zinc-100">Équipements</Link>
            <Link href="/history" className="hover:text-zinc-100">Historique</Link>
            <Link href="/rules" className="hover:text-zinc-100">Règles</Link>
            <Link href="/tariffs" className="hover:text-zinc-100">Tarifs</Link>
            <Link href="/control" className="hover:text-zinc-100">Pilotage</Link>
            <Link href="/kiosk" className="hover:text-zinc-100">Kiosk</Link>
          </nav>
        </header>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
