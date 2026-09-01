const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_ORIGIN_HOST = "127.0.0.1";
const START_TIMEOUT_MS = 120_000;

let mainWindow;
let serverProcess;
let serverLog;
let appUrl;

function offlineSpeechPaths() {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "offline-speech")
    : path.join(app.getAppPath(), "offline-speech");
  return {
    cli: path.join(root, "bin", "whisper-cli.exe"),
    server: path.join(root, "bin", "whisper-server.exe"),
    modelDirectory: path.join(root, "models"),
    model: path.join(root, "models", "ggml-small-q5_1.bin"),
    vadModel: path.join(root, "models", "ggml-silero-v6.2.0.bin"),
  };
}

function desktopStatus() {
  const speech = offlineSpeechPaths();
  const strongModelAvailable = fs.existsSync(path.join(speech.modelDirectory, "ggml-large-v3-turbo-q5_0.bin"));
  return {
    appVersion: app.getVersion(),
    offlineSpeechAvailable: fs.existsSync(speech.cli) && fs.existsSync(speech.model) && fs.existsSync(speech.vadModel),
    speechModel: strongModelAvailable
      ? "Adaptief: Whisper Large-v3 Turbo Q5 met Small-reserve"
      : "Adaptief: Whisper Small Q5; sterker modelpack optioneel",
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
      if (serverProcess && serverProcess.exitCode !== null) {
        return reject(new Error(`De lokale appserver stopte tijdens het starten met code ${serverProcess.exitCode}.`));
      }
      const request = http.get(`${url}/api/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        if (Date.now() >= deadline) return reject(new Error(`Lokale app gaf status ${response.statusCode}.`));
        setTimeout(poll, 250);
      });
      request.setTimeout(1_500, () => request.destroy());
      request.on("error", () => {
        if (serverProcess && serverProcess.exitCode !== null) {
          return reject(new Error(`De lokale appserver stopte tijdens het starten met code ${serverProcess.exitCode}.`));
        }
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
  const serverEntry = path.join(runtimeRoot, "server-bootstrap.cjs");
  if (!fs.existsSync(serverEntry)) {
    throw new Error("De desktopruntime ontbreekt. Bouw de Next.js-app eerst.");
  }

  const logPath = path.join(app.getPath("logs"), "service-ears-server.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  serverLog = fs.createWriteStream(logPath, { flags: "a" });
  const speech = offlineSpeechPaths();
  if (!fs.existsSync(speech.cli) || !fs.existsSync(speech.model) || !fs.existsSync(speech.vadModel)) {
    throw new Error("De lokale spraakmodule ontbreekt. Installeer Service Ears opnieuw.");
  }
  const runtimeModules = path.join(runtimeRoot, "runtime_modules");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: APP_ORIGIN_HOST,
    PORT: String(port),
    NODE_PATH: [runtimeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
    POS_ADAPTER: "mock",
    ORDER_ENGINE_MODE: "deterministic",
    LOCAL_WHISPER_CLI: speech.cli,
    LOCAL_WHISPER_SERVER: fs.existsSync(speech.server) ? speech.server : "",
    LOCAL_WHISPER_MODEL: speech.model,
    LOCAL_WHISPER_MODELS_DIRS: speech.modelDirectory,
    LOCAL_WHISPER_VAD_MODEL: speech.vadModel,
    LOCAL_WHISPER_MODEL_POLICY: process.env.LOCAL_WHISPER_MODEL_POLICY || "adaptive",
    LOCAL_WHISPER_MAX_THREADS: process.env.LOCAL_WHISPER_MAX_THREADS || "6",
    LOCAL_WHISPER_TARGET_LATENCY_MS: process.env.LOCAL_WHISPER_TARGET_LATENCY_MS || "30000",
    LOCAL_WHISPER_IDLE_UNLOAD_MS: process.env.LOCAL_WHISPER_IDLE_UNLOAD_MS || "180000",
    LOCAL_WHISPER_BACKEND: process.env.LOCAL_WHISPER_BACKEND || "CPU/BLAS",
    DEBUG_RETAIN_CONVERSATION: "false",
  };
  delete env.OPENAI_API_KEY;

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

function registerIpc() {
  ipcMain.handle("desktop:get-status", () => desktopStatus());
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
