"use client";
import { useEffect, useState } from "react";

/**
 * Viewport classification for automatic layout adaptation.
 *
 * Breakpoints are chosen from the device classes this workspace is actually
 * used on, and orientation comes from the screen ratio so a tall narrow window
 * (phone, split-screen, portrait tablet) stacks while a wide short one keeps
 * panels side by side.
 */
export type DeviceClass = "mobile" | "tablet" | "laptop" | "desktop" | "wide";
export type Orientation = "portrait" | "landscape" | "square";

export interface ViewportInfo {
  width: number;
  height: number;
  device: DeviceClass;
  orientation: Orientation;
  /** Short viewport (browser chrome, landscape phone): tighten vertical space. */
  short: boolean;
  /** Coarse pointer — touch targets take priority over density. */
  isTouch: boolean;
  /** True once measured in the browser (SSR renders the neutral default). */
  ready: boolean;
}

function classify(width: number): DeviceClass {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  if (width < 1440) return "laptop";
  if (width < 1920) return "desktop";
  return "wide";
}

function orientationOf(width: number, height: number): Orientation {
  if (height === 0) return "landscape";
  const ratio = width / height;
  if (ratio > 1.2) return "landscape";
  if (ratio < 0.85) return "portrait";
  return "square";
}

function measure(): Omit<ViewportInfo, "ready"> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return {
    width,
    height,
    device: classify(width),
    orientation: orientationOf(width, height),
    short: height < 720,
    isTouch: window.matchMedia("(pointer: coarse)").matches,
  };
}

const NEUTRAL: ViewportInfo = {
  width: 1440, height: 900, device: "desktop", orientation: "landscape",
  short: false, isTouch: false, ready: false,
};

/** Chart height that fits the device instead of a hard-coded pixel value. */
export function chartHeightFor(v: ViewportInfo): number {
  // Includes the decoding legend's collapsed header (~34px) that sits inside the
  // pane, so the candles themselves keep a usable share of the height.
  if (v.device === "mobile") return v.orientation === "portrait" ? 380 : 280;
  if (v.device === "tablet") return v.orientation === "portrait" ? 420 : 360;
  if (v.short) return 340;
  if (v.device === "laptop") return 430;
  return 470;
}

export function useViewport(): ViewportInfo {
  const [info, setInfo] = useState<ViewportInfo>(NEUTRAL);

  useEffect(() => {
    const update = () => setInfo({ ...measure(), ready: true });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const mq = window.matchMedia("(pointer: coarse)");
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      mq.removeEventListener("change", update);
    };
  }, []);

  return info;
}
