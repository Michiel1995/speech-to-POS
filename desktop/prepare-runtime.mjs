import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(desktopDirectory, "..");
const standaloneSource = path.join(projectRoot, ".next", "standalone");
const staticSource = path.join(projectRoot, ".next", "static");
const publicSource = path.join(projectRoot, "public");
const output = path.join(projectRoot, "desktop-runtime");
const runtimeModules = path.join(output, "runtime_modules");
const projectPackagePath = path.join(projectRoot, "package.json");

if (!fs.existsSync(path.join(standaloneSource, "server.js"))) {
  throw new Error("Next.js standalone runtime ontbreekt. Voer eerst de production-build uit.");
}
if (path.dirname(output) !== projectRoot) {
  throw new Error("Ongeldig desktop-runtimepad.");
}

if (fs.existsSync(output)) {
  for (const entry of fs.readdirSync(output)) {
    if (entry === "runtime_modules") continue;
    fs.rmSync(path.join(output, entry), { recursive: true, force: true });
  }
}
fs.cpSync(standaloneSource, output, {
  recursive: true,
  dereference: true,
  preserveTimestamps: true,
  filter(source) {
    const relative = path.relative(standaloneSource, source);
    return relative !== "node_modules" && !relative.startsWith(`node_modules${path.sep}`);
  },
});
fs.cpSync(staticSource, path.join(output, ".next", "static"), {
  recursive: true,
  dereference: true,
  preserveTimestamps: true,
});
fs.cpSync(publicSource, path.join(output, "public"), {
  recursive: true,
  dereference: true,
  preserveTimestamps: true,
});
fs.copyFileSync(
  path.join(desktopDirectory, "server-bootstrap.cjs"),
  path.join(output, "server-bootstrap.cjs"),
);

const projectPackage = JSON.parse(fs.readFileSync(projectPackagePath, "utf8"));
const projectRequire = createRequire(projectPackagePath);
const installedTargets = new Set();

function packageTarget(nodeModulesDirectory, packageName) {
  return path.join(nodeModulesDirectory, ...packageName.split("/"));
}

function resolvePackageRoot(requireFromPackage, packageName) {
  try {
    return path.dirname(requireFromPackage.resolve(`${packageName}/package.json`));
  } catch {
    let candidate = requireFromPackage.resolve(packageName);
    while (candidate !== path.dirname(candidate)) {
      candidate = path.dirname(candidate);
      const manifest = path.join(candidate, "package.json");
      if (fs.existsSync(manifest)) {
        const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (parsed.name === packageName) return candidate;
      }
    }
    throw new Error(`Package root niet gevonden voor ${packageName}.`);
  }
}

function packageVersion(packageRoot) {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
}

function installedVersion(target) {
  try {
    return JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")).version;
  } catch {
    return undefined;
  }
}

function materializePackage(packageName, sourceRoot, destinationNodeModules) {
  const target = packageTarget(destinationNodeModules, packageName);
  const sourceVersion = packageVersion(sourceRoot);
  if (installedVersion(target) === sourceVersion || installedTargets.has(target)) return target;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceRoot, target, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter(source) {
      return !source.endsWith(".d.ts") && !source.endsWith(".d.mts") && !source.endsWith(".map");
    },
  });
  installedTargets.add(target);

  const manifestPath = path.join(sourceRoot, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const requireFromPackage = createRequire(manifestPath);
  const required = Object.keys(manifest.dependencies ?? {});
  const optional = Object.keys(manifest.optionalDependencies ?? {}).filter((name) => !required.includes(name));

  for (const dependencyName of [...required, ...optional]) {
    let dependencyRoot;
    try {
      dependencyRoot = resolvePackageRoot(requireFromPackage, dependencyName);
    } catch (error) {
      if (optional.includes(dependencyName)) continue;
      throw error;
    }
    const dependencyVersion = packageVersion(dependencyRoot);
    const topLevelTarget = packageTarget(runtimeModules, dependencyName);
    const destination = !installedVersion(topLevelTarget) || installedVersion(topLevelTarget) === dependencyVersion
      ? runtimeModules
      : path.join(target, "node_modules");
    materializePackage(dependencyName, dependencyRoot, destination);
  }
  return target;
}

fs.mkdirSync(runtimeModules, { recursive: true });
for (const dependencyName of Object.keys(projectPackage.dependencies ?? {})) {
  const dependencyRoot = resolvePackageRoot(projectRequire, dependencyName);
  materializePackage(dependencyName, dependencyRoot, runtimeModules);
}

console.log(`Desktop runtime prepared at ${output} with ${installedTargets.size} production packages.`);
