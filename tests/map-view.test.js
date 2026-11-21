import test from 'node:test';
import assert from 'node:assert/strict';
import { horizontalRouteHeading, mapPointToCanvasPixel } from '../src/map.js';

test('map heading lays an eastbound route from left to right', () => {
  const stops = [
    { location: { lat: 31, lng: 121 } },
    { location: { lat: 31, lng: 121.01 } },
    { location: { lat: 31, lng: 121.02 } },
  ];
  const heading = horizontalRouteHeading(stops);
  assert.ok(Math.min(heading, 360 - heading) < 0.1);
});

test('map heading rotates a northbound route into a left-to-right view', () => {
  const stops = [
    { location: { lat: 31, lng: 121 } },
    { location: { lat: 31.02, lng: 121 } },
  ];
  assert.ok(Math.abs(horizontalRouteHeading(stops) - 270) < 0.1);
});

test('canvas route projection uses map-container pixels before overlay-pane pixels', () => {
  let projectedPoint;
  class Point { constructor(lng, lat) { this.lng = lng; this.lat = lat; } }
  const map = {
    pointToPixel(point) { projectedPoint = point; return { x: 100, y: 200 }; },
    pointToOverlayPixel() { return { x: 900, y: 800 }; },
  };

  assert.deepEqual(mapPointToCanvasPixel(map, { lng: 121.5, lat: 31.2 }, Point), { x: 100, y: 200 });
  assert.equal(projectedPoint.lng, 121.5);
  assert.equal(projectedPoint.lat, 31.2);
});

test('canvas route projection falls back when map-container projection is unavailable', () => {
  class Point { constructor(lng, lat) { this.lng = lng; this.lat = lat; } }
  const map = { pointToOverlayPixel: () => ({ x: 20, y: 30 }) };

  assert.deepEqual(mapPointToCanvasPixel(map, { lng: 121, lat: 31 }, Point), { x: 20, y: 30 });
});