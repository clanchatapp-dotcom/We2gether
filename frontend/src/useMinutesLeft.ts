import { useEffect, useState } from "react";

function calc(iso?: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));
}

// Minutes until `iso`, refreshed every 15 seconds.
export function useMinutesLeft(iso?: string | null) {
  const [mins, setMins] = useState(() => calc(iso));
  useEffect(() => {
    setMins(calc(iso));
    if (!iso) return;
    const t = setInterval(() => setMins(calc(iso)), 15000);
    return () => clearInterval(t);
  }, [iso]);
  return mins;
}

export function formatMinutesLeft(mins: number | null) {
  if (mins === null) return "";
  if (mins <= 1) return "<1m left";
  return `${mins}m left`;
}
