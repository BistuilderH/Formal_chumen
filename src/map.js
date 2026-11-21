// Official 4.0 example: https://lbs.baidu.com/docs/jsapi?title=jsapi4/quickstart/firstdemo
export const mainRouteColor = '#d9384f';
const commuteColors = ['#2f64d6', '#e08a2e', '#7a45b8', '#0a8f7a', '#d94c7b', '#5b6b8c'];
export const commuteColor = (originIndex) => commuteColors[Math.abs(Math.trunc(Number(originIndex) || 0)) % commuteColors.length];

export function mapPointToCanvasPixel(map, point, Point) {
  const sdkPoint = new Point(Number(point.lng), Number(point.lat));
  // Canvas uses map-container coordinates. Overlay pixels use a separate pane origin.
  return map.pointToPixel?.(sdkPoint) || map.pointToOverlayPixel?.(sdkPoint);
}

export function horizontalRouteHeading(stops = []) {
  const points = stops.filter(stop => stop?.location && Number.isFinite(Number(stop.location.lat)) && Number.isFinite(Number(stop.location.lng)));
  if (points.length < 2) return 0;
  const first = points[0].location;
  const last = points.at(-1).location;
  const lat1 = Number(first.lat) * Math.PI / 180;
  const lat2 = Number(last.lat) * Math.PI / 180;
  const deltaLng = (Number(last.lng) - Number(first.lng)) * Math.PI / 180;
  const bearing = Math.atan2(
    Math.sin(deltaLng) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng),
  ) * 180 / Math.PI;
  return ((bearing - 90) % 360 + 360) % 360;
}
let loader;
function loadSdk(ak) {
  if (window.BMap?.Map) return Promise.resolve(window.BMap);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const callback = '__chumenBaiduMapReady';
    const script = document.createElement('script');
    const timeout = setTimeout(() => finish(new Error('百度地图加载超时，请检查网络、浏览器端 AK 和域名白名单。')), 18000);
    let finished = false;
    function finish(error) {
      if (finished) return;
      finished = true; clearTimeout(timeout); delete window[callback];
      if (error) { script.remove(); reject(error); } else resolve(window.BMap);
    }
    window[callback] = () => window.BMap?.Map ? finish() : finish(new Error('地图 SDK 未能初始化，请核对浏览器端 AK 权限。'));
    script.src = `https://api.map.baidu.com/api?${new URLSearchParams({ v: '4.0', ak, callback })}`;
    script.async = true;
    script.onerror = () => finish(new Error('无法加载百度地图，请检查网络及域名白名单。'));
    document.head.appendChild(script);
  });
  return loader;
}
export function createBaiduMap(container, status, ak) {
  let map;
  let sdk;
  let currentCandidate;
  let currentCommuteIndex = null;
  let renderedId;
  let tilted = true;
  let heading = 0;
  let rightDragging = false;
  let lastRightX = 0;
  let rightPointerId;
  let routeCanvas;
  const validPoint = (point) => point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
  const isTextEntry = (target) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  const setHeading = (value, options = {}) => {
    heading = ((Number(value) % 360) + 360) % 360;
    map?.setHeading?.(heading, options);
  };
  const rotateBy = (delta, options = {}) => {
    const current = Number(map?.getHeading?.());
    setHeading((Number.isFinite(current) ? current : heading) + delta, options);
  };

  // Keep the map keyboard-accessible without hijacking form fields elsewhere on the page.
  container.tabIndex = 0;
  container.setAttribute('role', 'application');
  container.setAttribute('aria-label', '百度地图。Q 左转，E 右转，右键拖动旋转，左键拖动平移。');
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || isTextEntry(event.target)) return;
    if (event.key.toLowerCase() === 'q') { event.preventDefault(); rotateBy(-15); }
    if (event.key.toLowerCase() === 'e') { event.preventDefault(); rotateBy(15); }
  });
  container.addEventListener('pointerdown', (event) => {
    container.focus({ preventScroll: true });
    if (event.button !== 2) return;
    rightDragging = true;
    rightPointerId = event.pointerId;
    lastRightX = event.clientX;
    container.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, true);
  container.addEventListener('pointermove', (event) => {
    if (!rightDragging || event.pointerId !== rightPointerId) return;
    const deltaX = event.clientX - lastRightX;
    lastRightX = event.clientX;
    // Match the physical gesture: dragging the map to the right turns the view left.
    if (deltaX) rotateBy(-deltaX * 0.6, { noAnimation: true });
    event.preventDefault();
    event.stopPropagation();
  }, true);
  const stopRightDrag = (event) => {
    if (!rightDragging || (event.pointerId !== undefined && event.pointerId !== rightPointerId)) return;
    rightDragging = false;
    container.releasePointerCapture?.(rightPointerId);
    rightPointerId = undefined;
  };
  container.addEventListener('pointerup', stopRightDrag, true);
  container.addEventListener('pointercancel', stopRightDrag, true);
  container.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); }, true);
  function resizeRouteCanvas() {
    if (!routeCanvas) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    routeCanvas.width = Math.round(width * ratio);
    routeCanvas.height = Math.round(height * ratio);
    routeCanvas.style.width = `${width}px`;
    routeCanvas.style.height = `${height}px`;
    routeCanvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function drawRouteCanvas() {
    if (!routeCanvas || !map || !sdk) return;
    resizeRouteCanvas();
    const context = routeCanvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, container.clientWidth, container.clientHeight);
    const project = (point) => {
      return mapPointToCanvasPixel(map, point, sdk.Point);
    };
    const roundRect = (x, y, width, height, radius) => {
      const r = Math.min(radius, width / 2, height / 2);
      context.beginPath();
      context.moveTo(x + r, y);
      context.arcTo(x + width, y, x + width, y + height, r);
      context.arcTo(x + width, y + height, x, y + height, r);
      context.arcTo(x, y + height, x, y, r);
      context.arcTo(x, y, x + width, y, r);
      context.closePath();
    };
    const drawPolyline = (points, color, { dash = [], width = 5, glow = false, arrows = false } = {}) => {
      const pixels = points.filter(validPoint).map(project).filter((pixel) => pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y));
      if (pixels.length < 2) return false;
      const tracePath = () => {
        context.beginPath();
        pixels.forEach((pixel, index) => index ? context.lineTo(pixel.x, pixel.y) : context.moveTo(pixel.x, pixel.y));
      };
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      tracePath();
      context.lineWidth = width + 7;
      context.strokeStyle = 'rgba(255,255,255,.94)';
      context.setLineDash([]);
      context.stroke();
      if (glow) {
        tracePath();
        context.lineWidth = width + 14;
        context.strokeStyle = color;
        context.globalAlpha = 0.22;
        context.shadowColor = color;
        context.shadowBlur = 18;
        context.setLineDash([]);
        context.stroke();
        context.globalAlpha = 1;
        context.shadowBlur = 0;
        context.shadowColor = 'transparent';
      }
      tracePath();
      context.lineWidth = width;
      context.strokeStyle = color;
      context.setLineDash(dash);
      context.stroke();
      context.restore();
      if (arrows) drawDirectionArrows(pixels, color);
      return true;
    };
    const drawDirectionArrows = (pixels, color) => {
      const spacing = 92;
      let nextArrow = spacing / 2;
      let travelled = 0;
      for (let index = 1; index < pixels.length; index += 1) {
        const start = pixels[index - 1];
        const end = pixels[index];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const segmentLength = Math.hypot(dx, dy);
        if (segmentLength < 1) continue;
        while (travelled + segmentLength >= nextArrow) {
          const ratio = (nextArrow - travelled) / segmentLength;
          const x = start.x + dx * ratio;
          const y = start.y + dy * ratio;
          context.save();
          context.translate(x, y);
          context.rotate(Math.atan2(dy, dx));
          context.beginPath();
          context.moveTo(-9, -7);
          context.lineTo(2, 0);
          context.lineTo(-9, 7);
          context.closePath();
          context.fillStyle = 'rgba(255,255,255,.98)';
          context.fill();
          context.strokeStyle = color;
          context.lineWidth = 2;
          context.stroke();
          context.beginPath();
          context.moveTo(-6, -4);
          context.lineTo(1, 0);
          context.lineTo(-6, 4);
          context.closePath();
          context.fillStyle = color;
          context.fill();
          context.restore();
          nextArrow += spacing;
        }
        travelled += segmentLength;
      }
    };
    // Draw each visible member's commute first. The server removes paths for
    // members the viewer is not allowed to inspect, so paths are the only
    // source used here (never origin coordinates).
    for (const commute of (currentCandidate?.commutes || []).filter(item => currentCommuteIndex === item.originIndex)) {
      const color = commuteColor(commute.originIndex);
      for (const points of commute.paths || []) drawPolyline(points, color, { dash: [10, 8], width: 5 });
    }
    // The activity route is the visual focus and always uses the requested red.
    for (const leg of currentCandidate?.legs || []) {
      for (const points of leg.paths || []) {
        drawPolyline(points, mainRouteColor, { width: 6, glow: true, arrows: true });
      }
    }
    // Place labels in priority order and keep a small collision buffer between them.
    // Activity names are the primary map information. Commute details remain in the
    // route cards, so the map uses a compact summary that stays readable at a glance.
    const occupied = [];
    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;
    const labelGap = 8;
    const clampRect = (rect) => ({
      ...rect,
      x: Math.max(8, Math.min(rect.x, viewportWidth - rect.width - 8)),
      y: Math.max(8, Math.min(rect.y, viewportHeight - rect.height - 8)),
    });
    const overlaps = (a, b) => a.x < b.x + b.width + labelGap
      && a.x + a.width + labelGap > b.x
      && a.y < b.y + b.height + labelGap
      && a.y + a.height + labelGap > b.y;
    const canPlace = (rect) => occupied.every((item) => !overlaps(rect, item));
    const reserve = (rect) => { occupied.push(rect); return rect; };
    const drawLeader = (anchor, rect, color) => {
      const targetX = Math.max(rect.x, Math.min(anchor.x, rect.x + rect.width));
      const targetY = Math.max(rect.y, Math.min(anchor.y, rect.y + rect.height));
      if (Math.abs(anchor.x - targetX) < 4 && Math.abs(anchor.y - targetY) < 4) return;
      context.beginPath();
      context.moveTo(anchor.x, anchor.y);
      context.lineTo(targetX, targetY);
      context.strokeStyle = color + '88';
      context.lineWidth = 1.5;
      context.setLineDash([3, 3]);
      context.stroke();
      context.setLineDash([]);
    };
    const drawLabel = ({ rect, text, color, font, radius = 13 }) => {
      context.font = font || '700 11px Microsoft YaHei, sans-serif';
      context.shadowColor = 'rgba(31,42,72,.2)'; context.shadowBlur = 9; context.shadowOffsetY = 3;
      roundRect(rect.x, rect.y, rect.width, rect.height, radius);
      context.fillStyle = 'rgba(255,255,255,.97)'; context.fill();
      context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetY = 0;
      context.strokeStyle = color + '88'; context.lineWidth = 1; context.stroke();
      context.fillStyle = color; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width - 14);
    };
    const truncate = (value, maxWidth, font) => {
      context.font = font || '700 11px Microsoft YaHei, sans-serif';
      const text = String(value || '');
      if (context.measureText(text).width <= maxWidth) return text;
      let result = text;
      while (result.length > 1 && context.measureText(result + '…').width > maxWidth) result = result.slice(0, -1);
      return result + '…';
    };
    const placeLabel = (anchor, width, height, candidates) => {
      const offsets = [...candidates];
      const directions = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
      for (let ring = 0; ring < 5; ring += 1) {
        const distance = 16 + ring * 24;
        for (const [xDirection, yDirection] of directions) {
          offsets.push([
            xDirection * (xDirection ? width / 2 + distance : 0),
            yDirection * (yDirection ? height / 2 + distance : 0),
          ]);
        }
      }
      for (const [offsetX, offsetY] of offsets) {
        const rect = clampRect({ x: anchor.x + offsetX, y: anchor.y + offsetY, width, height });
        if (canPlace(rect)) return reserve(rect);
      }
      return null;
    };
    const placeStopMarker = (anchor) => {
      const size = 36;
      const offsets = [[0, 0]];
      const directions = [[1, 0], [0, -1], [-1, 0], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
      for (let ring = 0; ring < 5; ring += 1) {
        const distance = size + 14 + ring * 22;
        for (const [xDirection, yDirection] of directions) offsets.push([xDirection * distance, yDirection * distance]);
      }
      for (const [offsetX, offsetY] of offsets) {
        const rect = clampRect({ x: anchor.x + offsetX - size / 2, y: anchor.y + offsetY - size / 2, width: size, height: size });
        if (canPlace(rect)) {
          reserve(rect);
          return { x: rect.x + size / 2, y: rect.y + size / 2, mapAnchor: anchor };
        }
      }
      return null;
    };
    const labelCommands = [];
    const stopAnchors = [];
    for (const [index, stop] of (currentCandidate?.stops || []).entries()) {
      if (!validPoint(stop.location)) continue;
      const pixel = project(stop.location);
      if (!pixel) continue;
      const mapAnchor = { x: pixel.x, y: pixel.y - 14 };
      const marker = placeStopMarker(mapAnchor);
      if (!marker) continue;
      const name = truncate(stop.name || '活动地点', Math.min(210, Math.max(120, viewportWidth * 0.28)), '700 13px Microsoft YaHei, sans-serif');
      context.font = '700 13px Microsoft YaHei, sans-serif';
      const nameWidth = Math.min(Math.max(context.measureText(name).width + 22, 88), Math.min(238, viewportWidth - 20));
      const rect = placeLabel(marker, nameWidth, 30, [[18, -45], [18, 10], [-nameWidth - 18, -45], [-nameWidth - 18, 10], [-nameWidth / 2, -62], [-nameWidth / 2, 18]]);
      stopAnchors.push({ marker, index });
      if (rect) labelCommands.push({ rect, text: name, color: '#4a2130', anchor: marker, font: '700 13px Microsoft YaHei, sans-serif', radius: 8 });
    }
    for (const leg of currentCandidate?.legs || []) {
      const validPaths = (leg.paths || []).map((points) => points.filter(validPoint)).filter((points) => points.length >= 2);
      const allPoints = validPaths.flat();
      const middle = allPoints.length ? project(allPoints[Math.floor(allPoints.length / 2)]) : null;
      if (!middle) continue;
      const mode = modeText(leg.mode);
      const color = '#b5253d';
      const duration = Number.isFinite(leg.durationSeconds) ? Math.ceil(leg.durationSeconds / 60) + ' 分钟' : '时间待核实';
      const text = mode + ' ' + duration;
      context.font = '700 11px Microsoft YaHei, sans-serif';
      const labelWidth = Math.min(Math.max(context.measureText(text).width + 30, 92), Math.min(150, viewportWidth - 20));
      const rect = placeLabel(middle, labelWidth, 26, [[-labelWidth / 2, -14], [-labelWidth / 2, 18], [18, -13], [-labelWidth - 18, -13]]);
      const icon = mode === '骑行' ? '🚲' : mode === '步行' ? '🚶' : '↗';
      if (rect) labelCommands.push({ rect, text: icon + ' ' + text, color, anchor: middle });
    }
    for (const commute of (currentCandidate?.commutes || []).filter(item => currentCommuteIndex === item.originIndex)) {
      const validPaths = (commute.paths || []).map((points) => points.filter(validPoint)).filter((points) => points.length >= 2);
      const allPoints = validPaths.flat();
      const middle = allPoints.length ? project(allPoints[Math.floor(allPoints.length / 2)]) : null;
      if (!middle) continue;
      const color = commuteColor(commute.originIndex);
      const member = commute.memberLabel || '成员 ' + (Number(commute.originIndex) + 1);
      const mode = commuteModeText(commute);
      const duration = Number.isFinite(commute.durationSeconds) ? Math.ceil(commute.durationSeconds / 60) + ' 分钟' : '时间待核实';
      const text = member + ' · ' + mode + ' ' + duration;
      context.font = '700 11px Microsoft YaHei, sans-serif';
      const labelWidth = Math.min(Math.max(context.measureText(text).width + 24, 112), Math.min(190, viewportWidth - 20));
      const rect = placeLabel(middle, labelWidth, 26, [[-labelWidth / 2, -14], [-labelWidth / 2, 18], [18, -13], [-labelWidth - 18, -13], [-labelWidth / 2, -44]]);
      if (rect) labelCommands.push({ rect, text: '↗ ' + text, color, anchor: middle });
      const start = project(allPoints[0]);
      if (start) {
        occupied.push({ x: start.x - 14, y: start.y - 14, width: 28, height: 28 });
        labelCommands.push({ marker: start, markerColor: color, markerText: String(Number(commute.originIndex) + 1) });
      }
    }
    for (const command of labelCommands) {
      if (!command.marker && command.anchor) drawLeader(command.anchor, command.rect, command.color);
      else if (command.marker?.mapAnchor) drawLeader(command.marker.mapAnchor, command.marker, command.markerColor);
    }
    for (const command of labelCommands) {
      if (command.marker) {
        context.beginPath(); context.arc(command.marker.x, command.marker.y, 9, 0, Math.PI * 2);
        context.fillStyle = command.markerColor; context.fill(); context.lineWidth = 3; context.strokeStyle = '#fff'; context.stroke();
        context.fillStyle = '#fff'; context.font = '700 10px Microsoft YaHei, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(command.markerText, command.marker.x, command.marker.y);
        continue;
      }
      drawLabel(command);
    }
    for (const { marker, index } of stopAnchors) {
      context.beginPath(); context.arc(marker.x, marker.y, 16, 0, Math.PI * 2); context.fillStyle = '#c92546'; context.fill();
      context.beginPath(); context.arc(marker.x, marker.y, 13, 0, Math.PI * 2); context.fillStyle = '#e84a62'; context.fill();
      context.fillStyle = '#fff'; context.font = '700 15px Microsoft YaHei, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(index + 1), marker.x, marker.y);
    }
    context.setLineDash([]);
  }
  const modeText = (mode) => {
    const normalized = String(mode || '').toLowerCase();
    if (['cycling', 'riding', 'ride', 'bicycling'].includes(normalized)) return '骑行';
    if (['walking', 'walk', 'foot'].includes(normalized)) return '步行';
    return '其他交通';
  };
  const commuteModeText = (commute) => {
    const normalized = String(commute?.mode || '').toLowerCase();
    if (['walking', 'walk', 'foot'].includes(normalized)) return '步行';
    if (['cycling', 'riding', 'ride', 'bicycling'].includes(normalized)) return '骑行';
    if (normalized === 'transit') return '公交/地铁';
    return modeText(commute?.mode);
  };
  function draw() {
    if (!map || !sdk) return;
    const key = currentCandidate ? JSON.stringify([currentCandidate.id, currentCandidate.stops, currentCandidate.legs, currentCandidate.commutes, currentCommuteIndex]) : '';
    if (key === renderedId) return;
    renderedId = key;
    map.clearOverlays();
    if (!currentCandidate) { drawRouteCanvas(); status.textContent = '百度地图已加载，生成路线后显示地点和实际道路。'; return; }
    const bounds = [];
    let stopCount = 0;
    for (const stop of (currentCandidate.stops || [])) {
      if (!validPoint(stop.location)) continue;
      const point = new sdk.Point(Number(stop.location.lng), Number(stop.location.lat));
      bounds.push(point);
      stopCount += 1;
    }
    const commutePoints = (currentCandidate.commutes || []).filter(commute => currentCommuteIndex === commute.originIndex).flatMap((commute) => (commute.paths || []).flat()).filter(validPoint);
    bounds.push(...commutePoints.map((point) => new sdk.Point(Number(point.lng), Number(point.lat))));
    if (bounds.length) {
      if (stopCount > 1 && currentCommuteIndex === null) setHeading(horizontalRouteHeading(currentCandidate.stops), { noAnimation: true });
      map.setViewport(bounds, { margins: [28, 22, 28, 22] });
    }
    map.setTilt(tilted ? 65 : 0);
    drawRouteCanvas();
    const hasPaths = (currentCandidate.legs || []).some((leg) => leg.paths?.some((path) => path.length >= 2));
    const hasCommutePaths = (currentCandidate.commutes || []).some((leg) => leg.paths?.some((path) => path.length >= 2));
    status.textContent = bounds.length ? `已标记 ${stopCount} 个活动地点。${hasPaths ? '红色发光箭头线按站点顺序指引主路线。' : '道路轨迹暂未返回，仅显示地点。'}${currentCommuteIndex !== null && hasCommutePaths ? '已展开对应成员通勤路线。' : ''}白模建筑随区域和缩放级别显示。` : '该路线暂无可用坐标，请查看文字方案。';
  }
  const ready = (async () => {
    if (!ak) { status.textContent = '尚未配置浏览器端 AK，路线文字仍可使用。'; return false; }
    try {
      sdk = await loadSdk(ak);
      map = new sdk.Map(container, { displayOptions: { building: true, buildingSideGradation: false, poiText: false, poiIcon: true, overlay: true, isFlat: false, labelMargin: 8 } });
      map.setDisplayOptions?.({ building: true, buildingSideGradation: false, poiText: false, poiIcon: true, overlay: true, isFlat: false, labelMargin: 8 });
      map.centerAndZoom(new sdk.Point(121.48054, 31.235929), 14);
      map.enableScrollWheelZoom(true);
      map.enableDragging?.();
      map.enableRotate?.();
      map.enableRotateGestures?.();
      map.setTilt(65);
      setHeading(heading);
      routeCanvas = document.createElement('canvas');
      routeCanvas.setAttribute('aria-hidden', 'true');
      routeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
      container.appendChild(routeCanvas);
      resizeRouteCanvas();
      for (const eventName of ['moving', 'moveend', 'zoomend', 'heading_changed', 'tilt_changed', 'resize', 'tilesloaded']) map.addEventListener?.(eventName, drawRouteCanvas);
      window.ResizeObserver && new ResizeObserver(drawRouteCanvas).observe(container);
      status.textContent = '百度地图已加载，生成路线后显示地点和实际道路。';
      draw(); return true;
    } catch (error) { status.textContent = error.message; return false; }
  })();
  return { ready, showCandidate(candidate, options = {}) { currentCandidate = candidate; currentCommuteIndex = options.commuteIndex ?? null; try { draw(); } catch { status.textContent = '路线地图暂时无法绘制，请查看文字方案。'; } }, toggleTilt() { tilted = !tilted; map?.setTilt(tilted ? 65 : 0); } };
}
