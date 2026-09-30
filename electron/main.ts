import { app, BrowserWindow } from "electron";
import { join } from "node:path";

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true
    }
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    await win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    await win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
