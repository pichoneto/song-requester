import { qrcode } from "./vendor/qrcode.mjs";

export function renderQrCode(canvas, text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const context = canvas.getContext("2d");
  const modules = qr.getModuleCount();
  const quietZone = 4;
  const totalModules = modules + quietZone * 2;
  const scale = Math.floor(canvas.width / totalModules);
  const qrSize = totalModules * scale;
  const offset = Math.floor((canvas.width - qrSize) / 2);

  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (qr.isDark(row, col)) {
        context.fillRect(
          offset + (col + quietZone) * scale,
          offset + (row + quietZone) * scale,
          scale,
          scale,
        );
      }
    }
  }
}
