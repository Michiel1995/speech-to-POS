interface ServiceEarsDesktopStatus {
  appVersion: string;
  openaiConfigured: boolean;
  encryptedStorageAvailable: boolean;
}

interface ServiceEarsDesktopBridge {
  getStatus(): Promise<ServiceEarsDesktopStatus>;
  saveOpenAIKey(key: string): Promise<ServiceEarsDesktopStatus>;
  clearOpenAIKey(): Promise<ServiceEarsDesktopStatus>;
  onServerError(callback: (message: string) => void): () => void;
}

interface Window {
  serviceEarsDesktop?: ServiceEarsDesktopBridge;
}
