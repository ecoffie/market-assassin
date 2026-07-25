'use client';
/**
 * HeroOpportunityMap — the interactive map that fills the /home-v5 hero card. Rendered
 * directly on the page (not an iframe). Light CARTO Voyager basemap + pins colored by
 * set-aside, matching the full /opportunity-map. Pan + zoom-buttons enabled (scroll-zoom
 * OFF so it doesn't hijack page scroll); pins show a tooltip; an icon opens the full map.
 */
import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Pin = { lat: number; lng: number; set: string; label?: string };
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
        // interactive: pan + zoom buttons + double-click/touch zoom; scroll-zoom off (no page hijack)
        zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: true,
        doubleClickZoom: true, boxZoom: false, keyboard: true, touchZoom: true,
      }).setView([38, -96], 4);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19,
      }).addTo(map);
      const pts: Leaflet.LatLngExpression[] = [];
      for (const p of pins) {
        const m = L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: color[p.set] || '#64748b', fillOpacity: 0.95 });
        if (p.label) m.bindTooltip(p.label, { direction: 'top', offset: [0, -4] });
        m.addTo(map);
        pts.push([p.lat, p.lng]);
      }
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
    <div className="heromap">
      <div ref={el} className="heromap-canvas" />
      <a className="heromap-open" href="/opportunity-map" aria-label="Open the full opportunity map">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M10 14 21 3M21 14v7H3V3h7" /></svg>
      </a>
    </div>
  );
}
