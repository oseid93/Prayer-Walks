interface Point {
  latitude: number;
  longitude: number;
}

interface PointWithSession extends Point {
  sessionId?: string;
  timestamp?: string;
}

interface CoveragePolyline {
  coordinates: Point[];
  visitCount: number;
  color: string;
  width: number;
}

const GRID_SIZE = 0.00015;

function segmentGridKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  const gridLat = Math.round(midLat / GRID_SIZE) * GRID_SIZE;
  const gridLng = Math.round(midLng / GRID_SIZE) * GRID_SIZE;
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

function groupPointsBySessions(points: PointWithSession[]): Point[][] {
  if (points.length === 0) return [];

  const sessionMap = new Map<string, PointWithSession[]>();

  for (const p of points) {
    const sid = p.sessionId || "default";
    let arr = sessionMap.get(sid);
    if (!arr) {
      arr = [];
      sessionMap.set(sid, arr);
    }
    arr.push(p);
  }

  const sessions: Point[][] = [];
  sessionMap.forEach((pts) => {
    pts.sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      }
      return 0;
    });
    if (pts.length >= 2) {
      sessions.push(
        pts.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      );
    }
  });

  return sessions;
}

function countSegmentVisits(sessions: Point[][]): Map<string, number> {
  const visitCounts = new Map<string, number>();

  for (const session of sessions) {
    for (let i = 0; i < session.length - 1; i++) {
      const key = segmentGridKey(
        session[i].latitude,
        session[i].longitude,
        session[i + 1].latitude,
        session[i + 1].longitude,
      );
      visitCounts.set(key, (visitCounts.get(key) || 0) + 1);
    }
  }

  return visitCounts;
}

export function buildCoveragePolylines(
  points: PointWithSession[],
): CoveragePolyline[] {
  const sessions = groupPointsBySessions(points);
  if (sessions.length === 0) return [];

  const visitCounts = countSegmentVisits(sessions);

  const polylines: CoveragePolyline[] = [];

  for (const session of sessions) {
    if (session.length < 2) continue;

    let currentColor = "";
    let currentWidth = 0;
    let currentCount = 0;
    let currentCoords: Point[] = [];

    for (let i = 0; i < session.length - 1; i++) {
      const key = segmentGridKey(
        session[i].latitude,
        session[i].longitude,
        session[i + 1].latitude,
        session[i + 1].longitude,
      );
      const count = visitCounts.get(key) || 1;
      const color = getVisitColor(count);
      const width = getVisitWidth(count);

      if (color !== currentColor || width !== currentWidth) {
        if (currentCoords.length >= 2) {
          polylines.push({
            coordinates: currentCoords,
            visitCount: currentCount,
            color: currentColor,
            width: currentWidth,
          });
        }
        currentColor = color;
        currentWidth = width;
        currentCount = count;
        currentCoords = [session[i]];
      }

      currentCoords.push(session[i + 1]);
    }

    if (currentCoords.length >= 2) {
      polylines.push({
        coordinates: currentCoords,
        visitCount: currentCount,
        color: currentColor,
        width: currentWidth,
      });
    }
  }

  return polylines;
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
