"use client";

import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";

type MapEntry = {
  id: string;
  title: string;
  subtitle: string | null;
  type: string;
  latitude: number;
  longitude: number;
};

// Only the three geocodable types ever reach this component - Songs/
// Issues/Creators have no physical location, entries.latitude/longitude
// stay permanently null for them.
const TYPE_COLOR: Record<string, string> = {
  restaurant: "#5E2524", // rust
  venue: "#34495E", // slate
  event: "#B3CB84", // sage
};

const TYPE_LABEL: Record<string, string> = {
  restaurant: "Restaurants",
  venue: "Venues",
  event: "Events",
};

// Tampa, FL - PeakFeed is Tampa Bay scoped (per CLAUDE.md). Just the
// starting view; real pins are what actually populate the map.
const DEFAULT_CENTER: [number, number] = [27.9506, -82.4572];
const DEFAULT_ZOOM = 11;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// An entry with no resolved coordinate is never passed in here at all
// (filtered server-side) - no placeholder position, no coarser guess. It's
// fully visible in list views the whole time, just absent from this map
// until (or unless) its geocode job resolves.
export default function MapView({ entries }: { entries: MapEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(["restaurant", "venue", "event"])
  );

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((leafletModule) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = leafletModule.default;
      const map = L.map(containerRef.current, { zoomControl: false }).setView(
        DEFAULT_CENTER,
        DEFAULT_ZOOM
      );
      L.control.zoom({ position: "bottomright" }).addTo(map);
      // CARTO's free "Positron" basemap, not stock OSM tiles - same
      // underlying OSM data, muted grey/cream instead of full-color roads
      // and labels, so it doesn't visually compete with our brand-colored
      // pins. Free/keyless for this volume; requires crediting both OSM
      // (data source, same requirement as Nominatim) and CARTO (tile
      // rendering) - both present in the attribution string below.
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map);
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const markers: L.Marker[] = [];

    import("leaflet").then((leafletModule) => {
      if (cancelled) return;
      const L = leafletModule.default;
      const visible = entries.filter((e) => activeTypes.has(e.type));

      for (const entry of visible) {
        const color = TYPE_COLOR[entry.type] ?? "#34495E";
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:11px;height:11px;border-radius:50%;background:${color};border:1.5px solid #fff;box-shadow:0 1px 3px rgba(37,53,69,0.35);"></div>`,
          iconSize: [11, 11],
          iconAnchor: [5.5, 5.5],
        });
        const marker = L.marker([entry.latitude, entry.longitude], { icon }).addTo(map);
        marker.bindPopup(
          `<strong style="font-family:'Bebas Neue',sans-serif;letter-spacing:0.02em;font-size:15px;color:var(--slate-deep);">${escapeHtml(
            entry.title
          )}</strong>${
            entry.subtitle
              ? `<br/><span style="color:var(--slate);opacity:0.7;">${escapeHtml(entry.subtitle)}</span>`
              : ""
          }`
        );
        markers.push(marker);
      }
    });

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
    };
  }, [entries, activeTypes]);

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <div className="flex flex-col">
      <div className="pf-map-filters flex gap-2 p-3 overflow-x-auto">
        {Object.entries(TYPE_LABEL).map(([type, label]) => (
          <button
            key={type}
            onClick={() => toggleType(type)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors"
            style={{
              borderColor: TYPE_COLOR[type],
              background: activeTypes.has(type) ? TYPE_COLOR[type] : "transparent",
              color: activeTypes.has(type) ? "#fff" : TYPE_COLOR[type],
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="pf-map-canvas" style={{ height: "70vh" }} />
      {entries.length === 0 && (
        <p className="pf-map-empty text-xs text-center opacity-50 py-2">
          No entries have a resolved location yet — new Restaurant/Venue/Event
          entries get one within a day.
        </p>
      )}
    </div>
  );
}
