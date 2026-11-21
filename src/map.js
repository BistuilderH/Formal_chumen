// Official 4.0 example: https://lbs.baidu.com/docs/jsapi?title=jsapi4/quickstart/firstdemo
export const mainRouteColor = '#d9384f';
const commuteColors = ['#2f64d6', '#e08a2e', '#7a45b8', '#0a8f7a', '#d94c7b', '#5b6b8c'];
export const commuteColor = (originIndex) => commuteColors[Math.abs(Math.trunc(Number(originIndex) || 0)) % commuteColors.length];
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
      const sdkPoint = new sdk.Point(Number(point.lng), Number(point.lat));
      return map.pointToOverlayPixel?.(sdkPoint) || map.pointToPixel?.(sdkPoint);
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
    const drawPolyline = (points, color, { dash = [], width = 5 } = {}) => {
      const pixels = points.filter(validPoint).map(project).filter((pixel) => pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y));
      if (pixels.length < 2) return false;
      context.beginPath();
      pixels.forEach((pixel, index) => index ? context.lineTo(pixel.x, pixel.y) : context.moveTo(pixel.x, pixel.y));
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = width + 7;
      context.strokeStyle = 'rgba(255,255,255,.92)';
      context.setLineDash([]);
      context.stroke();
      context.beginPath();
      pixels.forEach((pixel, index) => index ? context.lineTo(pixel.x, pixel.y) : context.moveTo(pixel.x, pixel.y));
      context.lineWidth = width;
      context.strokeStyle = color;
      context.setLineDash(dash);
      context.stroke();
      return true;
    };
    // Draw each visible member's commute first. The server removes paths for
    // members the viewer is not allowed to inspect, so paths are the only
    // source used here (never origin coordinates).
    for (const commute of currentCandidate?.commutes || []) {
      const color = commuteColor(commute.originIndex);
      for (const points of commute.paths || []) drawPolyline(points, color, { dash: [10, 8], width: 5 });
    }
    // The activity route is the visual focus and always uses the requested red.
    for (const leg of currentCandidate?.legs || []) {
      for (const points of leg.paths || []) {
        drawPolyline(points, mainRouteColor, { width: 6 });
      }
    }
    // Draw route mode chips and destinations after the lines so they remain readable
    // even when the route passes in front of a 2.5D building model.
    context.setLineDash([]);
    for (const leg of currentCandidate?.legs || []) {
      const validPaths = (leg.paths || []).map((points) => points.filter(validPoint)).filter((points) => points.length >= 2);
      const allPoints = validPaths.flat();
      const middle = allPoints.length ? project(allPoints[Math.floor(allPoints.length / 2)]) : null;
      if (!middle) continue;
      const mode = modeText(leg.mode);
      const color = '#b5253d';
      const text = `${mode}${Number.isFinite(leg.durationSeconds) ? ` ${Math.ceil(leg.durationSeconds / 60)} 分钟` : ''}`;
      context.font = '700 11px Microsoft YaHei, sans-serif';
      const labelWidth = context.measureText(text).width + 30;
      context.shadowColor = 'rgba(31,42,72,.2)'; context.shadowBlur = 9; context.shadowOffsetY = 3;
      roundRect(middle.x - labelWidth / 2, middle.y - 14, labelWidth, 26, 13);
      context.fillStyle = 'rgba(255,255,255,.96)'; context.fill();
      context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetY = 0;
      context.strokeStyle = `${color}88`; context.lineWidth = 1; context.stroke();
      context.fillStyle = color; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(`${mode === '骑行' ? '🚲' : mode === '步行' ? '🚶' : '↗'} ${text}`, middle.x, middle.y - 1);
    }
    // Labels and start dots use returned paths only. Redacted commutes have
    // no map marker; their times remain available in the textual legend.
    for (const commute of currentCandidate?.commutes || []) {
      const validPaths = (commute.paths || []).map((points) => points.filter(validPoint)).filter((points) => points.length >= 2);
      const allPoints = validPaths.flat();
      const middle = allPoints.length ? project(allPoints[Math.floor(allPoints.length / 2)]) : null;
      if (!middle) continue;
      const color = commuteColor(commute.originIndex);
      const originName = String(commute.origin?.name || `成员 ${Number(commute.originIndex) + 1}`);
      const mode = commuteModeText(commute);
      const text = `${commute.memberLabel || `成员 ${Number(commute.originIndex) + 1}`} · ${originName} · ${mode} ${Number.isFinite(commute.durationSeconds) ? `${Math.ceil(commute.durationSeconds / 60)} 分钟` : '时间待核实'}`;
      const start = project(allPoints[0]);
      if (start) {
        context.beginPath(); context.arc(start.x, start.y, 9, 0, Math.PI * 2);
        context.fillStyle = color; context.fill(); context.lineWidth = 3; context.strokeStyle = '#fff'; context.stroke();
        context.font = '700 10px Microsoft YaHei, sans-serif'; context.fillStyle = '#fff'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(Number(commute.originIndex) + 1), start.x, start.y);
      }
      context.font = '700 11px Microsoft YaHei, sans-serif';
      const labelWidth = Math.min(Math.max(context.measureText(text).width + 24, 108), Math.max(120, container.clientWidth - 24));
      context.shadowColor = 'rgba(31,42,72,.2)'; context.shadowBlur = 9; context.shadowOffsetY = 3;
      roundRect(middle.x - labelWidth / 2, middle.y - 14, labelWidth, 26, 13);
      context.fillStyle = 'rgba(255,255,255,.96)'; context.fill();
      context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetY = 0;
      context.strokeStyle = `${color}88`; context.lineWidth = 1; context.stroke();
      context.fillStyle = color; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(`↗ ${text}`, middle.x, middle.y - 1, labelWidth - 12);
    }
    for (const [index, stop] of (currentCandidate?.stops || []).entries()) {
      if (!validPoint(stop.location)) continue;
      const pixel = project(stop.location);
      if (!pixel) continue;
      const name = String(stop.name || '活动地点');
      context.font = '700 13px Microsoft YaHei, sans-serif';
      const nameWidth = Math.min(Math.max(context.measureText(name).width + 18, 72), Math.max(90, container.clientWidth - 70));
      context.shadowColor = 'rgba(36,42,67,.2)'; context.shadowBlur = 12; context.shadowOffsetY = 4;
      roundRect(pixel.x + 17, pixel.y - 45, nameWidth, 30, 8);
      context.fillStyle = 'rgba(255,255,255,.97)'; context.fill();
      context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetY = 0;
      context.strokeStyle = 'rgba(184,35,62,.28)'; context.lineWidth = 1; context.stroke();
      context.beginPath(); context.arc(pixel.x, pixel.y - 14, 16, 0, Math.PI * 2); context.fillStyle = '#c92546'; context.fill();
      context.beginPath(); context.arc(pixel.x, pixel.y - 14, 13, 0, Math.PI * 2); context.fillStyle = '#e84a62'; context.fill();
      context.fillStyle = '#fff'; context.font = '700 15px Microsoft YaHei, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(index + 1), pixel.x, pixel.y - 14);
      context.fillStyle = '#4a2130'; context.font = '700 13px Microsoft YaHei, sans-serif'; context.textAlign = 'left'; context.fillText(name, pixel.x + 26, pixel.y - 30, nameWidth - 14);
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
    const key = currentCandidate ? JSON.stringify([currentCandidate.id, currentCandidate.stops, currentCandidate.legs, currentCandidate.commutes]) : '';
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
    const commutePoints = (currentCandidate.commutes || []).flatMap((commute) => (commute.paths || []).flat()).filter(validPoint);
    bounds.push(...commutePoints.map((point) => new sdk.Point(Number(point.lng), Number(point.lat))));
    if (bounds.length) {
      map.setViewport(bounds, { margins: [55, 45, 55, 45] });
      // Baidu's white-model layer begins rendering at closer zoom levels. Keep 2.5D
      // routes in that range while still fitting the selected stops first.
      if (tilted && !commutePoints.length && Number(map.getZoom?.()) < 15) map.setZoom?.(15);
    }
    map.setTilt(tilted ? 55 : 0);
    drawRouteCanvas();
    const hasPaths = (currentCandidate.legs || []).some((leg) => leg.paths?.some((path) => path.length >= 2));
    const hasCommutePaths = (currentCandidate.commutes || []).some((leg) => leg.paths?.some((path) => path.length >= 2));
    status.textContent = bounds.length ? `已标记 ${stopCount} 个活动地点。${hasPaths || hasCommutePaths ? '红色为主游玩路线，彩色虚线为可见成员到第 1 站的通勤路线。' : '道路轨迹暂未返回，仅显示地点。'}白模建筑随区域和缩放级别显示。` : '该路线暂无可用坐标，请查看文字方案。';
  }
  const ready = (async () => {
    if (!ak) { status.textContent = '尚未配置浏览器端 AK，路线文字仍可使用。'; return false; }
    try {
      sdk = await loadSdk(ak);
      map = new sdk.Map(container, { displayOptions: { building: true, buildingSideGradation: false, poiText: false, poiIcon: false, overlay: true, isFlat: false, labelMargin: 8 } });
      map.setDisplayOptions?.({ building: true, buildingSideGradation: false, poiText: false, poiIcon: false, overlay: true, isFlat: false, labelMargin: 8 });
      map.centerAndZoom(new sdk.Point(121.48054, 31.235929), 14);
      map.enableScrollWheelZoom(true);
      map.enableDragging?.();
      map.enableRotate?.();
      map.enableRotateGestures?.();
      map.setTilt(55);
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
  return { ready, showCandidate(candidate) { currentCandidate = candidate; try { draw(); } catch { status.textContent = '路线地图暂时无法绘制，请查看文字方案。'; } }, toggleTilt() { tilted = !tilted; map?.setTilt(tilted ? 55 : 0); } };
}
