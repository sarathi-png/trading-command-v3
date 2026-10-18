/**
 * The chart component: a WebView running the Lightweight Charts page.
 *
 * The library is bundled with the app (assets/charts), so the chart renders
 * offline and does not depend on a CDN. Data is pushed into the page as
 * JSON whenever it changes; the page pushes crosshair values back.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

import { buildChartHtml } from "./chartHtml";
import type { Candle } from "../api/types";

export interface ChartOverlay {
  id: string;
  title: string;
  color: string;
  width?: number;
  points: Array<{ time: number; value: number }>;
}

export interface ChartLevel {
  price: number;
  color: string;
  kind: "support" | "resistance";
  title: string;
}

export interface ChartMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
}

export interface ChartPayload {
  candles: Candle[];
  overlays: ChartOverlay[];
  levels: ChartLevel[];
  markers: ChartMarker[];
  chartType: "candles" | "heikin-ashi";
  error?: string;
  fit?: boolean;
}

let libraryPromise: Promise<string> | null = null;

/** Load (once) the bundled Lightweight Charts build. */
function loadLibrary(): Promise<string> {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      const asset = Asset.fromModule(
        require("../../assets/charts/lightweight-charts.standalone.production.js")
      );
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      return FileSystem.readAsStringAsync(uri);
    })();
  }
  return libraryPromise;
}

export function ChartView({
  payload,
  onCrosshair,
  height,
}: {
  payload: ChartPayload;
  onCrosshair?: (value: { time: number; value: number } | null) => void;
  height?: number;
}) {
  // react-native-webview v14 is generic; without an explicit type argument its
  // props collapse to `never`.
  const webViewRef = useRef<WebView<{}>>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const crosshairRef = useRef(onCrosshair);
  crosshairRef.current = onCrosshair;

  useEffect(() => {
    let cancelled = false;
    loadLibrary()
      .then((source) => {
        if (!cancelled) setHtml(buildChartHtml(source));
      })
      .catch(() => {
        if (!cancelled) setHtml(buildChartHtml(""));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Push data whenever it changes and the page is ready.
  useEffect(() => {
    if (!ready || !webViewRef.current) return;
    webViewRef.current.injectJavaScript(
      `window.__tcChart && window.__tcChart.setData(${JSON.stringify(payload)}); true;`
    );
  }, [ready, payload]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        type: string;
        time?: number;
        value?: number;
        message?: string;
      };
      if (message.type === "crosshair" && message.time !== undefined && message.value !== undefined) {
        crosshairRef.current?.({ time: message.time, value: message.value });
      }
    } catch {
      /* ignore malformed bridge messages */
    }
  };

  const source = useMemo(() => (html ? { html, baseUrl: "https://localhost" } : undefined), [html]);

  return (
    <View style={[styles.container, height ? { height } : null]}>
      {source ? (
        <WebView<{}>
          ref={webViewRef}
          source={source}
          onMessage={onMessage}
          onLoadEnd={() => setReady(true)}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          style={styles.webview}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#0b0e14" },
  webview: { flex: 1, backgroundColor: "#0b0e14" },
});
