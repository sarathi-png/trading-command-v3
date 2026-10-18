/**
 * The web build of the chart.
 *
 * react-native-webview has no web implementation, so the same page is hosted
 * in an iframe and the two channels are carried by `postMessage` instead of
 * `injectJavaScript` / `ReactNativeWebView.postMessage`:
 *
 *   app → chart   iframe.contentWindow.postMessage({ type: "tc:data" })
 *   chart → app   window.postMessage({ source: "tc-chart", ... })
 *
 * The page itself is the same `buildChartHtml` output used on a device, so
 * the two builds cannot drift apart.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Asset } from "expo-asset";

import { buildChartHtml } from "./chartHtml";
import type { ChartPayload } from "./ChartView";

let libraryPromise: Promise<string> | null = null;

/** Load the bundled chart library. On the web it is a URL, not a file. */
function loadLibrary(): Promise<string> {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      const asset = Asset.fromModule(
        require("../../assets/charts/lightweight-charts.standalone.production.txt")
      );
      const uri = asset.localUri ?? asset.uri;
      const response = await fetch(uri);
      return response.text();
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
  const frameRef = useRef<HTMLIFrameElement | null>(null);
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

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; time?: number; value?: number };
      if (!data || data.source !== "tc-chart" || data.type !== "crosshair") return;
      if (typeof data.time !== "number" || typeof data.value !== "number") return;
      crosshairRef.current?.({ time: data.time, value: data.value });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Push data whenever it changes and the frame is ready.
  useEffect(() => {
    if (!ready || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({ type: "tc:data", payload }, "*");
  }, [ready, payload]);

  const srcDoc = useMemo(() => html ?? "<!DOCTYPE html><html><body></body></html>", [html]);

  return (
    <View style={[styles.container, height ? { height } : null]}>
      {html ? (
        <iframe
          ref={frameRef}
          title="Trading Command chart"
          srcDoc={srcDoc}
          onLoad={() => setReady(true)}
          style={frameStyle}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#0b0e14" },
});

/** The iframe is a DOM element, so its style is plain CSS. */
const frameStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  border: 0,
  backgroundColor: "#0b0e14",
};
