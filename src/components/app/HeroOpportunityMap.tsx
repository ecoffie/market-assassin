'use client';
/**
 * HeroOpportunityMap — the compact live pin-map that fills the /home-v5 hero (replaces the
 * old quick-launch box). Real opportunity pins colored by set-aside; interactions are off so
 * it reads as a clickable preview → the full /opportunity-map. Not a fake image — real pins.
 */
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Pin = { lat: number; lng: number; set: string };
type Group = { key: string; label: string; color: string };

export default function HeroOpportunityMap({ pins, setGroups }: { pins: Pin[]; setGroups: Group[] }) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      if (cancelled || mapRef.current || !el.current) return;
      const L = mod.default;
      const color = Object.fromEntries(setGroups.map((g) => [g.key, g.color])) as Record<string, string>;
      const map = L.map(el.current, {
        zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
      }).setView([38, -96], 3.4);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map);
      for (const p of pins) {
        L.circleMarker([p.lat, p.lng], { radius: 3.5, color: 'transparent', fillColor: color[p.set] || '#94a3b8', fillOpacity: 0.9 }).addTo(map);
      }
      mapRef.current = map;
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, [pins, setGroups]);

  return (
    <Link className="heromap" href="/opportunity-map" aria-label="Open the federal opportunity map">
      <div ref={el} className="heromap-canvas" />
    </Link>
  );
}
