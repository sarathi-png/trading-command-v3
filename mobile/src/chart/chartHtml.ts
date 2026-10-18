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
</style>
</head>
<body>
<div id="chart"></div>
<div id="status">Waiting for market data…</div>
<script>${librarySource}</script>
<script>
(function () {
  var LWC = window.LightweightCharts;
  var container = document.getElementById('chart');
  var statusEl = document.getElementById('status');
  var chart = null;
  var candleSeries = null;
  var overlaySeries = {};   // id -> series
  var markerSeries = null;
  var priceLines = [];
  var lastPayload = null;

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

    if (payload.fit !== false) {
      chart.timeScale().fitContent();
    }
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
