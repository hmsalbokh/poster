import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("poster", { version: "0.1.0" });
