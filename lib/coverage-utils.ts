interface Point {
  latitude: number;
  longitude: number;
}

interface CoverageSegment {
  start: Point;
  end: Point;
  visitCount: number;
  color: string;
  width: number;
}

const GRID_SIZE = 0.0003;

function gridKey(lat: number, lng: number): string {
  const gridLat = Math.round(lat / GRID_SIZE) * GRID_SIZE;
  const gridLng = Math.round(lng / GRID_SIZE) * GRID_SIZE;
  return `${gridLat.toFixed(6)},${gridLng.toFixed(6)}`;
}

export function getVisitColor(count: number): string {
  if (count >= 6) return "#FF3B30";
  if (count >= 4) return "#FF9500";
  if (count >= 2) return "#FFCC00";
  return "#4CD964";
}

export function getVisitWidth(count: number): number {
  if (count >= 6) return 6;
  if (count >= 4) return 5;
  if (count >= 2) return 4;
  return 3;
}

export function buildCoverageSegments(points: Point[]): CoverageSegment[] {
  if (points.length < 2) return [];

  const segmentGrid: Map<string, { start: Point; end: Point; count: number }> =
    new Map();

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];

    const midLat = (start.latitude + end.latitude) / 2;
    const midLng = (start.longitude + end.longitude) / 2;
    const key = gridKey(midLat, midLng);

    const existing = segmentGrid.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      segmentGrid.set(key, { start, end, count: 1 });
    }
  }

  const segments: CoverageSegment[] = [];
  segmentGrid.forEach((seg) => {
    segments.push({
      start: seg.start,
      end: seg.end,
      visitCount: seg.count,
      color: getVisitColor(seg.count),
      width: getVisitWidth(seg.count),
    });
  });

  return segments;
}

export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(2)} km`;
}
