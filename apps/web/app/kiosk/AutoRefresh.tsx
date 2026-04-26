"use client";
import { useEffect } from "react";

export default function AutoRefresh({ seconds }: { seconds: number }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), seconds * 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  return null;
}
