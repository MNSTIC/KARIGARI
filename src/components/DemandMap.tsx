"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLanguage } from "@/lib/translations";

/** One buyer requirement inside a location group. */
export interface DemandEntry {
  id: string;
  craftType: string;
  quantity: number;
  targetPriceMin?: number | null;
  targetPriceMax?: number | null;
  festival?: string | null;
  buyerName?: string | null;
}

/**
 * One marker per resolvable location, carrying every demand posted there.
 * Grouping rather than one marker per demand: two buyers in Delhi would
 * otherwise render as one pin covering another, and nudging them apart would
 * mean inventing coordinates.
 */
export interface DemandMarker {
  /** Group key — the normalised location string. */
  id: string;
  lat: number;
  lon: number;
  location: string;
  distanceKm?: number | null;
  /** Any demand here matches the artisan's craft. */
  mine: boolean;
  /** Any demand here was posted in the last few minutes. */
  fresh: boolean;
  totalQuantity: number;
  demands: DemandEntry[];
}

export interface HomeMarker {
  lat: number;
  lon: number;
  label: string;
  supply?: number;
}

/** Used only when there is nothing at all to frame. */
const INDIA_CENTER: [number, number] = [22.5, 80];

function rupees(value?: number | null): string {
  return value || value === 0 ? `₹${value.toLocaleString("en-IN")}` : "—";
}

function priceLabel(demand: DemandEntry): string {
  const { targetPriceMin: min, targetPriceMax: max } = demand;
  if (min && max) return `${rupees(min)} – ${rupees(max)}`;
  if (max) return `≤ ${rupees(max)}`;
  if (min) return `≥ ${rupees(min)}`;
  return "—";
}

/**
 * Markers are built with divIcon rather than Leaflet's default PNG marker: the
 * default icon resolves its image through a bundler-relative URL that breaks
 * under Next's asset pipeline, and a div lets each pin carry the app's own
 * theme tokens and the pulse the legend describes.
 */
function pinIcon(color: string, opts: { pulse?: boolean; ring?: boolean } = {}) {
  const { pulse = false, ring = false } = opts;
  return L.divIcon({
    className: "",
    // 34px box so the 16px dot sits centred with room for the pulse ring.
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -12],
    html: `
      <span style="position:relative;display:block;width:34px;height:34px;">
        ${
          pulse
            ? `<span style="position:absolute;inset:2px;border-radius:9999px;background:${color};opacity:.3;animation:karigari-pin-ping 1.4s cubic-bezier(0,0,.2,1) infinite;"></span>`
            : ""
        }
        <span style="position:absolute;left:9px;top:9px;width:16px;height:16px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);${
          ring ? `outline:2px solid ${color};outline-offset:2px;` : ""
        }"></span>
      </span>`,
  });
}

/**
 * Frames the map on the real data instead of a fixed bbox.
 *
 * This is the point of the rewrite. The previous map was an OSM
 * `export/embed.html?bbox=…` iframe with hand-projected overlay pins: the embed
 * refits the requested bbox to the iframe's 16:9 box, so it displayed roughly
 * 55° of longitude where the projection maths assumed 29°, and every pin landed
 * hundreds of kilometres east of its city. Leaflet places markers by lat/lng and
 * derives the viewport from them, so that class of drift cannot happen.
 */
function FitBounds({ home, demands }: { home: HomeMarker | null; demands: DemandMarker[] }) {
  const map = useMap();

  // Stable dependency: refit only when the actual coordinates change.
  const signature = useMemo(
    () =>
      [home ? `${home.lat},${home.lon}` : "-", ...demands.map((d) => `${d.lat},${d.lon}`)].join("|"),
    [home, demands]
  );

  useEffect(() => {
    const container = map.getContainer();

    const fit = () => {
      // Leaflet caches its viewport size. This component arrives through a
      // dynamic import, so the map can initialise while its box is still 0px
      // wide — every zoom it derives from that measurement collapses to 0 (the
      // whole world). Re-measure first, and skip entirely while the box has no
      // size, so a hidden container never overwrites a good view.
      if (!container.clientWidth || !container.clientHeight) return;
      map.invalidateSize();

      const points: [number, number][] = demands.map((d) => [d.lat, d.lon]);
      if (home) points.push([home.lat, home.lon]);

      if (points.length === 0) {
        map.setView(INDIA_CENTER, 4);
        return;
      }
      if (points.length === 1) {
        map.setView(points[0], 6);
        return;
      }
      map.fitBounds(L.latLngBounds(points).pad(0.2), { animate: false });
    };

    // A ResizeObserver rather than a one-shot call: it fires immediately with
    // the current size and again whenever the box changes, which covers the
    // 0px-at-mount case, a pane being revealed, and ordinary window resizes.
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
    // `signature` encodes every coordinate; the map instance never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);

  return null;
}

export default function DemandMap({
  home,
  demands,
}: {
  home: HomeMarker | null;
  demands: DemandMarker[];
}) {
  const { t } = useLanguage();

  return (
    <div className="relative w-full aspect-video rounded-xl border border-gray-200 overflow-hidden shadow-inner">
      <style>{`@keyframes karigari-pin-ping{75%,100%{transform:scale(1.9);opacity:0}}`}</style>
      <MapContainer
        center={home ? [home.lat, home.lon] : INDIA_CENTER}
        zoom={home ? 6 : 4}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
        className="z-0"
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap"
        />
        <FitBounds home={home} demands={demands} />

        {home && (
          <Marker
            position={[home.lat, home.lon]}
            icon={pinIcon("var(--color-primary)", { ring: true })}
            zIndexOffset={1000}
          >
            <Popup>
              <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {t("your_location")}
              </span>
              <strong className="block text-sm text-gray-900">{home.label}</strong>
              {home.supply !== undefined && (
                <span className="block text-xs text-gray-500 mt-0.5">
                  {home.supply} {t("listed_items")}
                </span>
              )}
            </Popup>
          </Marker>
        )}

        {demands.map((group) => (
          <Marker
            key={group.id}
            position={[group.lat, group.lon]}
            icon={pinIcon(
              group.fresh
                ? "var(--color-stat-orange)"
                : group.mine
                  ? "var(--color-stat-teal)"
                  : "var(--color-primary-light)",
              { pulse: group.fresh || group.mine }
            )}
          >
            <Popup>
              <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {group.location}
                {group.distanceKm !== null && group.distanceKm !== undefined && (
                  <> · {group.distanceKm < 50 ? t("near_you") : `${group.distanceKm} km`}</>
                )}
              </span>
              <div className="mt-1 space-y-2">
                {group.demands.map((demand) => (
                  <div key={demand.id}>
                    <strong className="block text-sm text-gray-900">
                      {demand.quantity} × {demand.craftType}
                    </strong>
                    <span className="block text-xs font-bold text-gray-700">
                      {priceLabel(demand)}
                    </span>
                    {demand.festival && (
                      <span className="block text-[11px] uppercase tracking-wider text-gray-400">
                        {demand.festival}
                      </span>
                    )}
                    {demand.buyerName && (
                      <span className="block text-xs text-gray-500">{demand.buyerName}</span>
                    )}
                  </div>
                ))}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
