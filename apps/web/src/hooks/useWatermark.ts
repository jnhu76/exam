import { useEffect, useRef } from "react";

interface WatermarkOptions {
  text: string;
  font?: string;
  textColor?: string;
  opacity?: number;
  rotate?: number;
  gapX?: number;
  gapY?: number;
}

function generateWatermarkCanvas(
  text: string,
  font: string,
  textColor: string,
  rotate: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = 205;
  canvas.height = 140;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.font = font;
  ctx.fillStyle = textColor;
  ctx.textAlign = "left";
  ctx.fillText(text, canvas.width / 10, canvas.height / 2);
  return canvas.toDataURL("image/png");
}

export function useWatermark(options: WatermarkOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const {
      text,
      font = "20px sans-serif",
      textColor = "rgba(180, 180, 180, 0.3)",
      opacity = 1,
      rotate = -20,
      gapX = 0,
      gapY = 0,
    } = options;

    if (!text) return;

    const dataUrl = generateWatermarkCanvas(text, font, textColor, rotate);
    if (!dataUrl) return;

    const existing = document.getElementById("global-watermark");
    if (existing) existing.remove();

    const div = document.createElement("div");
    div.id = "global-watermark";
    div.style.cssText = [
      "position:fixed",
      "inset:0",
      "pointer-events:none",
      "z-index:9999",
      "background-repeat:repeat",
      `opacity:${opacity}`,
      gapX ? `background-position-x:${gapX}px` : "",
      gapY ? `background-position-y:${gapY}px` : "",
    ]
      .filter(Boolean)
      .join(";");
    div.style.backgroundImage = `url(${dataUrl})`;
    document.body.appendChild(div);
    containerRef.current = div;

    return () => {
      div.remove();
      containerRef.current = null;
    };
  }, [
    options.text,
    options.font,
    options.textColor,
    options.opacity,
    options.rotate,
    options.gapX,
    options.gapY,
  ]);

  return containerRef;
}
