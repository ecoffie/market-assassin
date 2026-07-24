'use client';
/**
 * HeroOpportunityMap — the map that fills the /home-v5 hero card. Rendered DIRECTLY on the
 * page (not an iframe — the iframe left the map zero-height/blank). Same look as the full
 * /opportunity-map: light CARTO Voyager basemap + pins colored by set-aside. The whole card
 * links to the full map. No text.
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
        zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
      }).setView([38, -96], 4);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19,
      }).addTo(map);
      const pts: Leaflet.LatLngExpression[] = [];
      for (const p of pins) {
        L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: color[p.set] || '#64748b', fillOpacity: 0.95 }).addTo(map);
        pts.push([p.lat, p.lng]);
      }
      // Frame the pins (US), not oceans. invalidateSize covers the initial layout race.
      const fit = () => {
        map.invalidateSize();
        if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.08), { animate: false, maxZoom: 5 });
      };
      fit();
      [120, 400, 900].forEach((t) => setTimeout(fit, t));
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
