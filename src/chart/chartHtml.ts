/**
 * The chart page that runs inside the WebView.
 *
 * It is a self-contained document: the TradingView Lightweight Charts
 * standalone build is inlined, so the chart works with no network access and
 * no page loads. React Native talks to it through two channels:
 *
 *   RN → chart   window.__tcChart.setData(payload)   (injected JavaScript)
 *   chart → RN   window.ReactNativeWebView.postMessage(json)
 *
 * Keeping the rendering in a WebView is what allows the mobile app to reuse
 * the exact charting library the desktop terminal uses.
 */
export function buildChartHtml(librarySource: string): string {
  // A literal `</script` inside the library would end the tag early.
  const library = librarySource.replace(/<\/script/gi, "<\\/script");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; background: #0b0e14; overflow: hidden; }
  #chart { width: 100vw; height: 100vh; }
  #status {
    position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    color: #9aa3b2; font: 13px -apple-system, system-ui, sans-serif; text-align: center; padding: 24px;
  }
  #overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .tc-box { position: absolute; box-sizing: border-box; }
  .tc-label {
    position: absolute; white-space: pre; line-height: 1.25; font-weight: 600;
    padding: 2px 5px; border-radius: 3px; pointer-events: none;
  }
  .tc-label.tiny { font-size: 9px; padding: 1px 3px; }
  .tc-label.small { font-size: 11px; }
  .tc-label.normal { font-size: 12px; }
  .tc-label.large { font-size: 14px; }
  .tc-label.center { transform: translate(-50%, -50%); }
  .tc-label.up { transform: translate(-50%, -100%); }
  .tc-label.down { transform: translate(-50%, 0); }
  .tc-label.left { transform: translate(-100%, -50%); }
  .tc-label.right { transform: translate(0, -50%); }
  .tc-label.lower_left { transform: translate(-100%, 0); }
  .tc-label.lower_right { transform: translate(0, 0); }
  .tc-label.upper_left { transform: translate(-100%, -100%); }
  .tc-label.upper_right { transform: translate(0, -100%); }
  .tc-label.arrow { background: transparent !important; padding: 0; }
  .tc-label.cross { background: transparent !important; padding: 0; font-size: 14px; }
  .tc-table {
    position: absolute; display: grid; gap: 1px; font-size: 10px; line-height: 1.3;
    border-radius: 3px; overflow: hidden;
  }
  .tc-table div { padding: 2px 6px; white-space: nowrap; }
</style>
</head>
<body>
<div id="chart"></div>
<div id="overlay"></div>
<div id="status">Waiting for market data…</div>
<script>${library}</script>
<script>
(function () {
  var LWC = window.LightweightCharts;
  var container = document.getElementById('chart');
  var statusEl = document.getElementById('status');
  var overlayEl = document.getElementById('overlay');
  var chart = null;
  var candleSeries = null;
  var overlaySeries = {};   // id -> series
  var markerSeries = null;
  var priceLines = [];
  var lastPayload = null;
  var lastCandleCount = -1;

  function showStatus(text) {
    if (!text) { statusEl.style.display = 'none'; return; }
    statusEl.textContent = text;
    statusEl.style.display = 'flex';
  }

  function buildChart(payload) {
    if (chart) { chart.remove(); chart = null; }
    overlaySeries = {};
    priceLines = [];
    markerSeries = null;

    chart = LWC.createChart(container, {
      layout: {
        background: { type: 'solid', color: '#0b0e14' },
        textColor: '#9aa3b2',
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: '#22262f', separatorHoverColor: '#2b3040', enableResize: true }
      },
      grid: {
        vertLines: { color: '#141821' },
        horzLines: { color: '#141821' }
      },
      rightPriceScale: { borderColor: '#22262f', scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: '#22262f', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: '#4a5568', width: 1, style: 2, labelBackgroundColor: '#2b3040' },
        horzLine: { color: '#4a5568', width: 1, style: 2, labelBackgroundColor: '#2b3040' }
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, pinch: true },
      localization: { locale: 'en-US' }
    });

    candleSeries = chart.addSeries(LWC.CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceLineVisible: false,
      lastValueVisible: true
    });

    if (payload.chartType === 'heikin-ashi') {
      candleSeries.applyOptions({
        upColor: '#4a7dff', downColor: '#c05bd6',
        borderUpColor: '#4a7dff', borderDownColor: '#c05bd6',
        wickUpColor: '#4a7dff', wickDownColor: '#c05bd6'
      });
    }

    // The drawings are DOM elements positioned over the chart, so they have
    // to be moved whenever the visible range changes.
    chart.timeScale().subscribeVisibleLogicalRangeChange(function () { renderDrawings(); });

    chart.subscribeCrosshairMove(function (param) {
      if (!param || !param.time || !candleSeries) return;
      var value = param.seriesData.get(candleSeries);
      if (!value) return;
      post({ type: 'crosshair', time: param.time, value: value.close });
    });
  }

  function post(message) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
      return;
    }
    // The web build hosts this page in an iframe and listens on the window.
    try {
      window.parent.postMessage(Object.assign({ source: 'tc-chart' }, message), '*');
    } catch (e) {}
  }


  /* -------------------------------------------------------------- */
  /* Pine drawings: boxes, labels and tables                         */
  /* -------------------------------------------------------------- */

  function labelClass(style) {
    var name = String(style || 'label_down');
    name = name.replace(/^label_/, '').replace(/^style_/, '');
    var known = ['center', 'up', 'down', 'left', 'right', 'lower_left', 'lower_right',
      'upper_left', 'upper_right', 'circle', 'square', 'arrowup', 'arrowdown', 'flag',
      'text_outline', 'xcross', 'cross', 'triangleup', 'triangledown', 'none'];
    if (known.indexOf(name) < 0) return 'center';
    return name;
  }

  function drawBox(drawing) {
    if (drawing.leftTime == null || drawing.rightTime == null) return;
    if (drawing.top == null || drawing.bottom == null) return;
    var x1 = chart.timeScale().timeToCoordinate(drawing.leftTime);
    var x2 = chart.timeScale().timeToCoordinate(drawing.rightTime);
    var y1 = candleSeries.priceToCoordinate(drawing.top);
    var y2 = candleSeries.priceToCoordinate(drawing.bottom);
    if (x1 == null || x2 == null || y1 == null || y2 == null) return;
    var el = document.createElement('div');
    el.className = 'tc-box';
    el.style.left = Math.min(x1, x2) + 'px';
    el.style.top = Math.min(y1, y2) + 'px';
    el.style.width = Math.max(1, Math.abs(x2 - x1)) + 'px';
    el.style.height = Math.max(1, Math.abs(y2 - y1)) + 'px';
    el.style.border = (drawing.borderWidth || 1) + 'px solid ' + (drawing.borderColor || 'transparent');
    el.style.background = drawing.bgcolor || 'transparent';
    if (drawing.text) {
      el.style.color = drawing.textColor || '#ffffff';
      el.style.fontSize = '10px';
      el.style.padding = '2px 4px';
    }
    overlayEl.appendChild(el);
  }

  function drawLabel(drawing) {
    if (drawing.time == null || drawing.price == null) return;
    var x = chart.timeScale().timeToCoordinate(drawing.time);
    var y = candleSeries.priceToCoordinate(drawing.price);
    if (x == null || y == null) return;
    var kind = labelClass(drawing.style);
    var el = document.createElement('div');
    el.className = 'tc-label ' + kind + ' ' + (drawing.size || 'normal');
    el.textContent = drawing.text || '';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (kind === 'circle' || kind === 'square') {
      el.style.background = drawing.color || 'transparent';
      el.style.width = '8px';
      el.style.height = '8px';
      el.style.borderRadius = kind === 'circle' ? '50%' : '2px';
      el.style.transform = 'translate(-50%, -50%)';
    } else if (kind === 'arrowup' || kind === 'arrowdown' || kind === 'triangleup' || kind === 'triangledown') {
      el.textContent = (kind === 'arrowup' || kind === 'triangleup') ? '\u25b2' : '\u25bc';
      el.style.color = drawing.color || '#ffffff';
      el.style.transform = 'translate(-50%, -50%)';
    } else if (kind === 'cross' || kind === 'xcross') {
      el.textContent = kind === 'cross' ? '\u2715' : '\u2716';
      el.style.color = drawing.color || '#ffffff';
      el.style.transform = 'translate(-50%, -50%)';
    } else if (kind === 'none') {
      el.style.background = 'transparent';
    } else {
      el.style.background = drawing.color || 'rgba(0, 0, 0, 0.6)';
      el.style.color = drawing.textColor || '#ffffff';
    }
    overlayEl.appendChild(el);
  }

  function drawTable(drawing) {
    var el = document.createElement('div');
    el.className = 'tc-table';
    var position = String(drawing.position || 'top_right');
    el.style.gridTemplateColumns = 'repeat(' + Math.max(1, drawing.columns || 1) + ', auto)';
    if (position.indexOf('bottom') >= 0) el.style.bottom = '8px';
    else el.style.top = '8px';
    if (position.indexOf('left') >= 0) el.style.left = '8px';
    else el.style.right = '72px';
    var cells = drawing.cells || [];
    for (var row = 0; row < (drawing.rows || 1); row++) {
      for (var column = 0; column < (drawing.columns || 1); column++) {
        var cell = document.createElement('div');
        var found = null;
        for (var i = 0; i < cells.length; i++) {
          if (cells[i].row === row && cells[i].column === column) { found = cells[i]; break; }
        }
        cell.textContent = found ? found.text : '';
        cell.style.color = found ? found.textColor : '#c7ccd8';
        cell.style.background = found ? found.bgcolor : 'rgba(0, 0, 0, 0)';
        cell.style.textAlign = found ? found.halign : 'left';
        el.appendChild(cell);
      }
    }
    overlayEl.appendChild(el);
  }

  function renderDrawings() {
    if (!overlayEl || !chart || !candleSeries) return;
    overlayEl.innerHTML = '';
    var drawings = (lastPayload && lastPayload.drawings) || [];
    for (var i = 0; i < drawings.length; i++) {
      var drawing = drawings[i];
      try {
        if (drawing.kind === 'box') drawBox(drawing);
        else if (drawing.kind === 'label') drawLabel(drawing);
        else if (drawing.kind === 'table') drawTable(drawing);
      } catch (error) { /* a broken drawing must not break the chart */ }
    }
  }

  function toSeriesData(points) {
    return (points || []).map(function (point) {
      return { time: point.time, value: point.value };
    });
  }

  function setData(payload) {
    lastPayload = payload;
    if (!chart) buildChart(payload);
    showStatus(payload.error || '');

    candleSeries.setData((payload.candles || []).map(function (c) {
      return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close };
    }));

    // Remove old overlay series, then re-create them from the payload.
    Object.keys(overlaySeries).forEach(function (id) {
      try { chart.removeSeries(overlaySeries[id]); } catch (e) {}
      delete overlaySeries[id];
    });
    (payload.overlays || []).forEach(function (overlay) {
      var series = chart.addSeries(LWC.LineSeries, {
        color: overlay.color || '#3d7eff',
        lineWidth: overlay.width || 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: overlay.title
      });
      series.setData(toSeriesData(overlay.points));
      overlaySeries[overlay.id] = series;
    });

    // Support/resistance levels as price lines.
    priceLines.forEach(function (line) {
      try { candleSeries.removePriceLine(line); } catch (e) {}
    });
    priceLines = [];
    (payload.levels || []).forEach(function (level) {
      priceLines.push(candleSeries.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: level.kind === 'support' ? 2 : 0,
        axisLabelVisible: true,
        title: level.title
      }));
    });

    // Pine markers (strategy entries/exits, plotshapes).
    var markers = (payload.markers || []).map(function (marker) {
      return {
        time: marker.time,
        position: marker.position || 'aboveBar',
        color: marker.color || '#f0b90b',
        shape: marker.shape || 'arrowUp',
        text: marker.text || ''
      };
    });
    if (!markerSeries) {
      markerSeries = LWC.createSeriesMarkers(candleSeries, markers);
    } else {
      markerSeries.setMarkers(markers);
    }

    var candleCount = (payload.candles || []).length;
    if (payload.fit !== false && candleCount !== lastCandleCount) {
      chart.timeScale().fitContent();
    }
    lastCandleCount = candleCount;

    renderDrawings();
  }

  window.__tcChart = {
    setData: function (payload) {
      try { setData(payload); } catch (error) {
        post({ type: 'error', message: String(error && error.message ? error.message : error) });
      }
    },
    resize: function (width, height) {
      if (chart) chart.resize(width, height);
    }
  };

  // The web build cannot inject JavaScript, so data arrives by message.
  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== 'tc:data') return;
    try { setData(data.payload); } catch (error) { post({ type: 'error', message: String(error) }); }
  });

  window.addEventListener('resize', function () {
    if (chart) chart.resize(container.clientWidth, container.clientHeight);
  });

  // The container may not have a size yet when the script runs.
  setTimeout(function () {
    if (chart) chart.resize(container.clientWidth, container.clientHeight);
  }, 50);
})();
</script>
</body>
</html>`;
}
