/**
 * Convert geographic lat/lon coordinates to 3D positions on the India GLB model.
 *
 * The India GLB model is oriented with its front face up (Y-axis) and the map
 * spread across the XZ plane. We use India's geographic bounding box to map
 * lat/lon → normalised [0,1] → model-space XZ, then raycast downward to find
 * the exact surface point on the mesh.
 */

import * as THREE from "three";

/* ---- India geographic bounds (WGS-84) ---------------------------------- */
const LAT_MIN = 6.5;   // Kanyakumari
const LAT_MAX = 37.5;  // Kashmir
const LON_MIN = 68.0;  // Gujarat coast
const LON_MAX = 98.0;  // Arunachal Pradesh

/**
 * Normalise a lat/lon pair to [0,1] within India's bounding box.
 * Values outside the box are clamped.
 */
function normalise(lat: number, lon: number): { nx: number; nz: number } {
  const nx = Math.max(0, Math.min(1, (lon - LON_MIN) / (LON_MAX - LON_MIN)));
  // Latitude is inverted: higher lat → lower Z (north is "up" on the model)
  const nz = Math.max(0, Math.min(1, 1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)));
  return { nx, nz };
}

/**
 * Given a loaded GLB scene (THREE.Group), compute the model's axis-aligned
 * bounding box once and return a converter function.
 *
 * The converter maps (lat, lon) → THREE.Vector3 on the model surface.
 * If raycasting misses the mesh (e.g. point is at the very edge), it falls
 * back to a flat projection at the model's top surface Y.
 */
export function createGeoMapper(scene: THREE.Group) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Build a list of meshes for raycasting
  const meshes: THREE.Mesh[] = [];
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshes.push(child as THREE.Mesh);
    }
  });

  const raycaster = new THREE.Raycaster();
  const downDir = new THREE.Vector3(0, -1, 0);

  /**
   * Map lat/lon to a 3D point on the model surface.
   */
  return function mapLatLon(
    lat: number,
    lon: number
  ): THREE.Vector3 {
    const { nx, nz } = normalise(lat, lon);

    // Map normalised coords to model-space XZ
    const x = box.min.x + nx * size.x;
    const z = box.min.z + nz * size.z;

    // Raycast from well above the model straight down
    const origin = new THREE.Vector3(x, box.max.y + 10, z);
    raycaster.set(origin, downDir);

    for (const mesh of meshes) {
      const hits = raycaster.intersectObject(mesh, true);
      if (hits.length > 0) {
        return hits[0].point.clone();
      }
    }

    // Fallback: place on top surface
    return new THREE.Vector3(x, box.max.y, z);
  };
}
