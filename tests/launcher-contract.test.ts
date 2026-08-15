import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const commandLauncher = fs.readFileSync(
  path.join(projectRoot, "portable", "Start-Service-Ears-Lokaal.cmd"),
  "utf8",
);
const powershellLauncher = fs.readFileSync(
  path.join(projectRoot, "portable", "Start-Service-Ears-Lokaal.ps1"),
  "utf8",
);
const packager = fs.readFileSync(
  path.join(projectRoot, "desktop", "package-test-outputs.mjs"),
  "utf8",
);

describe("portable launcher contract", () => {
  it("starts through the execution-policy-safe PowerShell entry point", () => {
    expect(commandLauncher).toContain("-ExecutionPolicy Bypass");
    expect(commandLauncher).toContain("Start-Service-Ears-Lokaal.ps1");
    expect(commandLauncher).toContain("if errorlevel 1");
  });

  it("waits for the packaged server to be healthy before opening the UI", () => {
    expect(powershellLauncher).toContain('Invoke-RestMethod -Uri "$origin/api/health"');
    expect(powershellLauncher).toContain("[DateTime]::UtcNow.AddSeconds(120)");

    const serverStart = powershellLauncher.indexOf("$server = Start-Process");
    const healthLoop = powershellLauncher.indexOf("if (Test-ServiceEarsHealth)", serverStart);
    const browserOpen = powershellLauncher.indexOf("Open-ServiceEars", healthLoop);

    expect(serverStart).toBeGreaterThan(-1);
    expect(healthLoop).toBeGreaterThan(serverStart);
    expect(browserOpen).toBeGreaterThan(healthLoop);
  });

  it("quotes the server entry point for normal Windows paths with spaces", () => {
    expect(powershellLauncher).toContain(
      `$serverArgument = '"' + $serverEntry + '"'`,
    );
    expect(powershellLauncher).toContain("-ArgumentList $serverArgument");
    expect(powershellLauncher).not.toContain("-ArgumentList @($serverEntry)");
  });

  it("ships and checksums both launcher layers", () => {
    expect(packager).toContain('"Start-Service-Ears-Lokaal.cmd"');
    expect(packager).toContain('"Start-Service-Ears-Lokaal.ps1"');

    const checksumList = packager.slice(packager.indexOf("const checksumFiles"));
    expect(checksumList).toContain('"Start-Service-Ears-Lokaal.cmd"');
    expect(checksumList).toContain('"Start-Service-Ears-Lokaal.ps1"');
  });
});
