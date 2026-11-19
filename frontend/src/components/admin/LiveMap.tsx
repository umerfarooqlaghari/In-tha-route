"use client";

import "leaflet/dist/leaflet.css";

import type * as L from "leaflet";
import { useEffect, useRef } from "react";

import { AREA_CENTER } from "@/lib/geo";

export interface MapPin {
  id: string;
  kind: "driver" | "restaurant" | "dropoff";
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  /** Plain-text lines shown when the pin is clicked. */
  popup?: string[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function pinHtml(p: MapPin) {
  if (p.kind === "driver") {
    const c = p.color ?? "#2F6FED";
    if (p.label) {
      // A rider with initials (the merchant's own riders map).
      return `<div style="position:relative;width:40px;height:40px">
        <span style="position:absolute;inset:-4px;border-radius:999px;background:${c};opacity:.25;animation:pulse-ring 1.8s infinite"></span>
        <span style="position:absolute;inset:0;border-radius:999px;background:${c};border:3px solid #fff;box-shadow:0 6px 16px rgb(0 0 0/.3);display:grid;place-items:center;color:#fff;font:800 12px/1 var(--font-sans)">${esc(p.label)}</span>
      </div>`;
    }
    return `<div style="position:relative;width:34px;height:34px">
      <span style="position:absolute;inset:0;border-radius:999px;background:${c};opacity:.25;animation:pulse-ring 1.8s infinite"></span>
      <span style="position:absolute;inset:7px;border-radius:999px;background:${c};border:3px solid #fff;box-shadow:0 4px 14px rgb(0 0 0/.35)"></span>
    </div>`;
  }
  if (p.kind === "restaurant") {
    return `<div style="width:34px;height:34px;border-radius:12px;background:#14151A;border:3px solid #fff;display:grid;place-items:center;box-shadow:0 6px 18px rgb(0 0 0/.35)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.4-4.4A2 2 0 0 1 7.8 2h8.4a2 2 0 0 1 1.4.6L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.6-.5.6.6 0 0 0-.8 0 2.7 2.7 0 0 1-3.2 0 .6.6 0 0 0-.8 0 2.7 2.7 0 0 1-3.2 0 .6.6 0 0 0-.8 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/></svg>
    </div>`;
  }
  return `<div style="width:30px;height:38px;position:relative">
    <svg width="30" height="38" viewBox="0 0 30 38"><path d="M15 37s13-12.4 13-22A13 13 0 0 0 2 15c0 9.6 13 22 13 22z" fill="${p.color ?? "#E5484D"}" stroke="#fff" stroke-width="2.5"/></svg>
    <span style="position:absolute;top:6px;left:0;right:0;text-align:center;color:#fff;font:700 11px/16px var(--font-sans)">${esc(p.label ?? "")}</span>
  </div>`;
}

const SIZE: Record<MapPin["kind"], [number, number]> = { driver: [34, 34], restaurant: [34, 34], dropoff: [30, 38] };

/**
 * The admin's live map (OpenStreetMap tiles, softened to match the panel): merchants, drop-offs and
 * drivers with a recent GPS position. Pins update in place on every refresh;
 * the view frames all pins the first time they arrive.
 */
export function LiveMap({
  pins,
  className,
  focus,
}: {
  pins: MapPin[];
  className?: string;
  /** Pans to this spot whenever `focus.key` changes (e.g. a rider picked in a list). */
  focus?: { key: string; lat: number; lng: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const lib = useRef<typeof L | null>(null);
  const framed = useRef(false);
  const pinsRef = useRef(pins);

  const draw = () => {
    const Lf = lib.current;
    if (!Lf || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const all = pinsRef.current;
    all.forEach((p) => {
      const big = p.kind === "driver" && !!p.label;
      const anchor: [number, number] = p.kind === "dropoff" ? [15, 37] : big ? [20, 20] : [17, 17];
      const marker = Lf.marker([p.lat, p.lng], {
        icon: Lf.divIcon({ className: "itr-pin", html: pinHtml(p), iconSize: big ? [40, 40] : SIZE[p.kind], iconAnchor: anchor }),
        zIndexOffset: p.kind === "driver" ? 1000 : p.kind === "dropoff" ? 500 : 0,
        keyboard: false,
      });
      if (p.popup?.length) {
        marker.bindPopup(
          p.popup.map((line, i) => (i === 0 ? `<strong>${esc(line)}</strong>` : `<span style="color:#50535C">${esc(line)}</span>`)).join("<br/>"),
          { offset: [0, p.kind === "dropoff" ? -30 : -12] }
        );
      }
      marker.addTo(layer.current!);
    });
    if (!framed.current && all.length) {
      framed.current = true;
      const bounds = Lf.latLngBounds(all.map((p) => [p.lat, p.lng] as [number, number]));
      map.current.fitBounds(bounds.pad(0.25), { maxZoom: 14, animate: false });
    }
  };

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      const Lf = (mod as unknown as { default?: typeof L }).default ?? (mod as unknown as typeof L);
      if (cancelled || !el.current || map.current) return;
      lib.current = Lf;
      map.current = Lf.map(el.current, {
        center: [AREA_CENTER.latitude, AREA_CENTER.longitude],
        zoom: 13,
        zoomControl: false,
        scrollWheelZoom: false,
        attributionControl: true,
      });
      Lf.control.zoom({ position: "bottomright" }).addTo(map.current);
      Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "itr-tiles",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map.current);
      layer.current = Lf.layerGroup().addTo(map.current);
      // Scroll-zoom only after the user clicks into the map, so the page still scrolls.
      map.current.on("click", () => map.current?.scrollWheelZoom.enable());
      map.current.on("mouseout", () => map.current?.scrollWheelZoom.disable());
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
      framed.current = false;
    };
  }, []);

  // Redraw when the pins change (cheap: a few dozen markers).
  const signature = pins
    .map((p) => `${p.id}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}:${p.label ?? ""}:${p.color ?? ""}:${(p.popup ?? []).join("/")}`)
    .join("|");
  useEffect(() => {
    pinsRef.current = pins;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (focus && map.current) map.current.flyTo([focus.lat, focus.lng], Math.max(map.current.getZoom(), 14), { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  // Keep tiles right when the container changes size (sidebar collapse, window resize).
  useEffect(() => {
    if (!el.current) return;
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
    ro.observe(el.current);
    return () => ro.disconnect();
  }, []);

  return <div ref={el} className={className} />;
}
