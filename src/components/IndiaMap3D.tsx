"use client";

import { useRef, useMemo, useCallback, useState, useEffect, Suspense, memo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { createGeoMapper } from "@/lib/geoTo3D";
import type { DemandMarker, HomeMarker } from "@/components/DemandMap";

/* ── helpers ────────────────────────────────────────────────────────────── */

function rupees(value?: number | null): string {
  return value || value === 0 ? `₹${value.toLocaleString("en-IN")}` : "—";
}

function priceLabel(demand: { targetPriceMin?: number | null; targetPriceMax?: number | null }): string {
  const { targetPriceMin: min, targetPriceMax: max } = demand;
  if (min && max) return `${rupees(min)} – ${rupees(max)}`;
  if (max) return `≤ ${rupees(max)}`;
  if (min) return `≥ ${rupees(min)}`;
  return "—";
}

/* ── colour tokens ──────────────────────────────────────────────────────── */
const COLORS = {
  mine:  "#1a7a6d",   // deep teal
  fresh: "#c44536",   // warm red-orange
  other: "#6d4c41",   // earthy brown
  home:  "#2c3e50",   // dark slate
};

/* ── Beacon Beam ────────────────────────────────────────────────────────── */

interface BeaconProps {
  position: THREE.Vector3;
  color: string;
  pulse?: boolean;
  isHome?: boolean;
  label: string;
  details?: React.ReactNode;
}

const BeaconBeam = memo(function BeaconBeam({
  position,
  color,
  pulse = false,
  isHome = false,
  label,
  details,
}: BeaconProps) {
  const glowRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const beamHeight = isHome ? 2.8 : 1.8;
  const beamRadius = isHome ? 0.15 : 0.10;

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Pulse the glow ring
    if (glowRef.current && pulse) {
      const scale = 1 + 0.3 * Math.sin(t * 2.5);
      glowRef.current.scale.set(scale, 1, scale);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.25 + 0.15 * Math.sin(t * 2.5);
    }

    // Home ring rotation
    if (ringRef.current) {
      ringRef.current.rotation.y = t * 0.4;
    }
  });

  const handlePointer = useCallback(
    (enter: boolean) => {
      setHovered(enter);
      document.body.style.cursor = enter ? "pointer" : "auto";
    },
    []
  );

  return (
    <group position={[position.x, position.y, position.z]}>
      {/* Base dot */}
      <mesh position={[0, 0.04, 0]}>
        <sphereGeometry args={[isHome ? 0.12 : 0.08, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Pulse ring at base */}
      {pulse && (
        <mesh ref={glowRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.1, 0.28, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.25} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Home ring */}
      {isHome && (
        <mesh ref={ringRef} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.15, 0.19, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Main vertical beam — solid core */}
      <mesh
        position={[0, beamHeight / 2, 0]}
        onPointerEnter={() => handlePointer(true)}
        onPointerLeave={() => handlePointer(false)}
      >
        <cylinderGeometry args={[beamRadius * 0.3, beamRadius, beamHeight, 8, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Outer glow beam */}
      <mesh position={[0, beamHeight / 2, 0]}>
        <cylinderGeometry args={[beamRadius * 0.5, beamRadius * 2.5, beamHeight, 8, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Beam tip */}
      <mesh position={[0, beamHeight, 0]}>
        <sphereGeometry args={[beamRadius * 1.8, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>

      {/* Tooltip on hover */}
      {hovered && (
        <Html
          position={[0, beamHeight + 0.4, 0]}
          center
          style={{ pointerEvents: "none" }}
          zIndexRange={[1000, 1001]}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.96)",
              backdropFilter: "blur(8px)",
              borderRadius: 10,
              padding: "10px 14px",
              boxShadow: "0 3px 12px rgba(0,0,0,0.18)",
              border: "1px solid #ddd",
              width: 220,
              wordWrap: "break-word" as const,
            }}
          >
            <span style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#666" }}>
              {label}
            </span>
            {details}
          </div>
        </Html>
      )}
    </group>
  );
});

/* ── India 3D Model ─────────────────────────────────────────────────────── */

interface IndiaModelProps {
  home: HomeMarker | null;
  demands: DemandMarker[];
}

function IndiaModel({ home, demands }: IndiaModelProps) {
  const { scene } = useGLTF("/india_clean.glb");
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);

  // Clone scene so multiple instances don't collide — preserve original materials
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  // Build geo mapper once model is loaded
  const mapper = useMemo(() => createGeoMapper(clonedScene as unknown as THREE.Group), [clonedScene]);

  // Centre and scale the model, set fixed camera
  useEffect(() => {
    if (!groupRef.current) return;

    const box = new THREE.Box3().setFromObject(clonedScene);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    // Scale to fill the view well
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 8 / maxDim;
    groupRef.current.scale.setScalar(scale);
    groupRef.current.position.set(-center.x * scale, -center.y * scale + 0.5, -center.z * scale);

    // Fixed camera — slightly elevated top-down angled view
    camera.position.set(0, 9, 7);
    camera.lookAt(0, 0, 0);
  }, [clonedScene, camera]);

  // Compute beacon positions from demands
  const beacons = useMemo(() => {
    return demands.map((marker) => {
      const rawPos = mapper(marker.lat, marker.lon);
      return {
        marker,
        position: rawPos,
        color: marker.fresh ? COLORS.fresh : marker.mine ? COLORS.mine : COLORS.other,
        pulse: marker.fresh || marker.mine,
      };
    });
  }, [demands, mapper]);

  const homeBeacon = useMemo(() => {
    if (!home) return null;
    return {
      position: mapper(home.lat, home.lon),
    };
  }, [home, mapper]);

  return (
    <group ref={groupRef}>
      {/* The India model — original materials preserved */}
      <primitive object={clonedScene} />

      {/* Demand beacons */}
      {beacons.map((b) => (
        <BeaconBeam
          key={b.marker.id}
          position={b.position}
          color={b.color}
          pulse={b.pulse}
          label={b.marker.location}
          details={
            <div style={{ marginTop: 4 }}>
              {b.marker.demands.slice(0, 2).map((d) => (
                <div key={d.id} style={{ marginBottom: 3 }}>
                  <strong style={{ display: "block", fontSize: 12, color: "#222" }}>
                    {d.quantity} × {d.craftType}
                  </strong>
                  <span style={{ display: "block", fontSize: 11, color: "#777" }}>
                    {priceLabel(d)}
                  </span>
                </div>
              ))}
              {b.marker.demands.length > 2 && (
                <span style={{ display: "block", fontSize: 10, color: "#aaa" }}>
                  +{b.marker.demands.length - 2} more
                </span>
              )}
            </div>
          }
        />
      ))}

      {/* Home beacon */}
      {homeBeacon && home && (
        <BeaconBeam
          position={homeBeacon.position}
          color={COLORS.home}
          pulse
          isHome
          label={home.label}
          details={
            home.supply !== undefined ? (
              <span style={{ display: "block", fontSize: 11, color: "#666", marginTop: 3 }}>
                {home.supply} listed items
              </span>
            ) : undefined
          }
        />
      )}
    </group>
  );
}

// Preload the model
useGLTF.preload("/india_clean.glb");

/* ── Main exported component ────────────────────────────────────────────── */

export default function IndiaMap3D({
  home,
  demands,
}: {
  home: HomeMarker | null;
  demands: DemandMarker[];
}) {
  return (
    <div className="relative w-full aspect-video rounded-xl border border-gray-200 overflow-hidden shadow-inner"
      style={{
        background: "radial-gradient(ellipse at 50% 50%, #1a3a5c 0%, #152d4a 40%, #0f2238 100%)",
      }}
    >
      <Canvas
        camera={{ position: [0, 9, 7], fov: 35 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        {/* Warm lighting to complement the model's original colours */}
        <ambientLight intensity={0.8} color="#fff5eb" />
        <directionalLight position={[8, 12, 8]} intensity={1.2} color="#fffaf0" />
        <directionalLight position={[-5, 8, -5]} intensity={0.4} color="#f0e6d6" />
        <hemisphereLight args={["#fdf8f0", "#d4c8b8", 0.5]} />

        <Suspense fallback={null}>
          <IndiaModel home={home} demands={demands} />
        </Suspense>

        {/* Interactive — rotate and zoom allowed, zoom-out capped */}
        <OrbitControls
          enableRotate={true}
          enablePan={false}
          enableZoom={true}
          minDistance={6}
          maxDistance={16}
          maxPolarAngle={Math.PI / 2.2}
          minPolarAngle={Math.PI / 6}
        />
      </Canvas>
    </div>
  );
}
