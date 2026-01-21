export type DebugOverlayConfig = {
  cornerHitAreaFraction: number;
  edgeHitAreaFraction: number;
};

export function createInteractionDebugOverlay(
  target: HTMLElement,
  config: DebugOverlayConfig
) {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "9999";
  overlay.style.border = "1px dashed rgba(255,255,255,0.25)";
  overlay.style.boxSizing = "border-box";

  const cornerColor = "rgba(80, 180, 255, 0.18)";
  const edgeColor = "rgba(255, 180, 80, 0.12)";

  const cornerBR = document.createElement("div");
  const cornerTR = document.createElement("div");
  const cornerBL = document.createElement("div");
  const cornerTL = document.createElement("div");
  const edgeR = document.createElement("div");
  const edgeL = document.createElement("div");
  const pageBoundsLeft = document.createElement("div");
  const pageBoundsRight = document.createElement("div");

  const zones = [cornerBR, cornerTR, cornerBL, cornerTL, edgeR, edgeL];
  zones.forEach((zone) => {
    zone.style.position = "absolute";
    zone.style.boxSizing = "border-box";
    zone.style.border = "1px solid rgba(255,255,255,0.2)";
    overlay.appendChild(zone);
  });

  const bounds = [pageBoundsLeft, pageBoundsRight];
  bounds.forEach((box) => {
    box.style.position = "absolute";
    box.style.boxSizing = "border-box";
    box.style.border = "2px solid rgba(120, 220, 120, 0.6)";
    overlay.appendChild(box);
  });
  pageBoundsLeft.style.borderColor = "rgba(120, 220, 120, 0.6)";
  pageBoundsRight.style.borderColor = "rgba(220, 120, 120, 0.6)";

  const label = document.createElement("div");
  label.style.position = "absolute";
  label.style.left = "8px";
  label.style.top = "8px";
  label.style.padding = "6px 8px";
  label.style.borderRadius = "6px";
  label.style.background = "rgba(10, 14, 18, 0.7)";
  label.style.border = "1px solid rgba(255,255,255,0.12)";
  label.style.color = "#e9eef5";
  label.style.fontSize = "11px";
  label.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  label.textContent = "hit: none";
  overlay.appendChild(label);

  cornerBR.style.background = cornerColor;
  cornerTR.style.background = cornerColor;
  cornerBL.style.background = cornerColor;
  cornerTL.style.background = cornerColor;
  edgeR.style.background = edgeColor;
  edgeL.style.background = edgeColor;

  function update() {
    const rect = target.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const cornerSize = Math.min(rect.width, rect.height) * config.cornerHitAreaFraction;
    const edgeSize = Math.min(rect.width, rect.height) * config.edgeHitAreaFraction;

    cornerBR.style.right = "0px";
    cornerBR.style.bottom = "0px";
    cornerBR.style.width = `${cornerSize}px`;
    cornerBR.style.height = `${cornerSize}px`;

    cornerTR.style.right = "0px";
    cornerTR.style.top = "0px";
    cornerTR.style.width = `${cornerSize}px`;
    cornerTR.style.height = `${cornerSize}px`;

    cornerBL.style.left = "0px";
    cornerBL.style.bottom = "0px";
    cornerBL.style.width = `${cornerSize}px`;
    cornerBL.style.height = `${cornerSize}px`;

    cornerTL.style.left = "0px";
    cornerTL.style.top = "0px";
    cornerTL.style.width = `${cornerSize}px`;
    cornerTL.style.height = `${cornerSize}px`;

    edgeR.style.right = "0px";
    edgeR.style.top = `${cornerSize}px`;
    edgeR.style.bottom = `${cornerSize}px`;
    edgeR.style.width = `${edgeSize}px`;

    edgeL.style.left = "0px";
    edgeL.style.top = `${cornerSize}px`;
    edgeL.style.bottom = `${cornerSize}px`;
    edgeL.style.width = `${edgeSize}px`;
  }

  update();
  window.addEventListener("resize", update);
  document.body.appendChild(overlay);

  return {
    setMessage(message: string) {
      label.textContent = message;
    },
    setPageBounds(
      side: "left" | "right",
      bounds: { minX: number; maxX: number; minY: number; maxY: number } | null
    ) {
      const box = side === "left" ? pageBoundsLeft : pageBoundsRight;
      if (!bounds) {
        box.style.display = "none";
        return;
      }
      box.style.display = "block";
      box.style.left = `${bounds.minX}px`;
      box.style.top = `${bounds.minY}px`;
      box.style.width = `${Math.max(0, bounds.maxX - bounds.minX)}px`;
      box.style.height = `${Math.max(0, bounds.maxY - bounds.minY)}px`;
    },
    destroy() {
      window.removeEventListener("resize", update);
      overlay.remove();
    },
  };
}
