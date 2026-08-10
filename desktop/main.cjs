const { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_ORIGIN_HOST = "127.0.0.1";
const SETTINGS_FILE = "desktop-settings.json";
const START_TIMEOUT_MS = 45_000;

let mainWindow;
let serverProcess;
let serverLog;
let appUrl;

function settingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function readStoredKey() {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (!stored.encryptedOpenAIKey || !safeStorage.isEncryptionAvailable()) return "";
    return safeStorage.decryptString(Buffer.from(stored.encryptedOpenAIKey, "base64"));
  } catch {
    return "";
  }
}

function writeStoredKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows-versleuteling is niet beschikbaar op dit apparaat.");
  }
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const payload = {
    encryptedOpenAIKey: safeStorage.encryptString(key).toString("base64"),
  };
  fs.writeFileSync(settingsPath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function clearStoredKey() {
  try {
    fs.rmSync(settingsPath(), { force: true });
  } catch {
    // A missing settings file already means the key is cleared.
  }
}

function desktopStatus() {
  return {
    appVersion: app.getVersion(),
    openaiConfigured: Boolean(readStoredKey() || process.env.OPENAI_API_KEY),
    encryptedStorageAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, APP_ORIGIN_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => port ? resolve(port) : reject(new Error("Geen lokale poort beschikbaar.")));
    });
  });
}

function waitForHealth(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const request = http.get(`${url}/api/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        if (Date.now() >= deadline) return reject(new Error(`Lokale app gaf status ${response.statusCode}.`));
        setTimeout(poll, 250);
      });
      request.setTimeout(1_500, () => request.destroy());
      request.on("error", () => {
        if (Date.now() >= deadline) return reject(new Error("De lokale appserver startte niet op tijd."));
        setTimeout(poll, 250);
      });
    };
    poll();
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  serverProcess = undefined;
  if (serverLog) serverLog.end();
  serverLog = undefined;
}

async function startServer() {
  stopServer();
  const port = await getFreePort();
  const runtimeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(app.getAppPath(), ".next", "standalone");
  const serverEntry = path.join(runtimeRoot, "server.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error("De desktopruntime ontbreekt. Bouw de Next.js-app eerst.");
  }

  const logPath = path.join(app.getPath("logs"), "service-ears-server.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  serverLog = fs.createWriteStream(logPath, { flags: "a" });
  const openaiKey = readStoredKey() || process.env.OPENAI_API_KEY || "";
  const runtimeModules = path.join(runtimeRoot, app.isPackaged ? "runtime_modules" : "node_modules");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: APP_ORIGIN_HOST,
    PORT: String(port),
    NODE_PATH: [runtimeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
    POS_ADAPTER: "mock",
    ORDER_ENGINE_MODE: openaiKey ? "openai" : "deterministic",
    OPENAI_ORDER_MODEL: process.env.OPENAI_ORDER_MODEL || "gpt-5.4-mini",
    OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe-diarize",
    DEBUG_RETAIN_CONVERSATION: "false",
  };
  if (openaiKey) env.OPENAI_API_KEY = openaiKey;
  else delete env.OPENAI_API_KEY;

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: runtimeRoot,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.pipe(serverLog);
  serverProcess.stderr.pipe(serverLog);
  serverProcess.on("exit", (code) => {
    if (code && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:server-error", `Lokale server stopte met code ${code}.`);
    }
  });

  appUrl = `http://${APP_ORIGIN_HOST}:${port}`;
  await waitForHealth(appUrl);
  return appUrl;
}

async function restartServer() {
  const url = await startServer();
  if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(url);
}

function registerIpc() {
  ipcMain.handle("desktop:get-status", () => desktopStatus());
  ipcMain.handle("desktop:save-openai-key", async (_event, value) => {
    const key = typeof value === "string" ? value.trim() : "";
    if (!key || key.length > 512 || /\s/.test(key)) {
      throw new Error("Voer een geldige OpenAI API-sleutel zonder spaties in.");
    }
    writeStoredKey(key);
    await restartServer();
    return desktopStatus();
  });
  ipcMain.handle("desktop:clear-openai-key", async () => {
    clearStoredKey();
    await restartServer();
    return desktopStatus();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 390,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f2f1dd",
    title: "Service Ears",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!appUrl || !url.startsWith(appUrl)) event.preventDefault();
  });
  void mainWindow.loadURL(appUrl);
}

const lockAcquired = app.requestSingleInstanceLock();
if (!lockAcquired) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpc();
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
      return permission === "media" && Boolean(appUrl) && requestingOrigin.startsWith(appUrl);
    });
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = permission === "media" && Boolean(appUrl) && webContents.getURL().startsWith(appUrl);
      callback(allowed);
    });
    try {
      await startServer();
      createWindow();
    } catch (error) {
      dialog.showErrorBox("Service Ears kon niet starten", error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });
}

app.on("before-quit", stopServer);
app.on("window-all-closed", () => app.quit());
