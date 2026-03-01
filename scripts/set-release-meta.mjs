#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function printHelp() {
  console.log(`Usage:
  npm run release:set -- --version 1.0.0 --product-name "Pawdio Lab"
  npm run release:build -- --version 1.0.0 --product-name "Pawdio Lab"

Options:
  --version <semver>       Set package + Tauri + Cargo version (e.g. 1.0.0)
  --product-name <name>    Set Tauri productName (affects installer/app bundle naming)
  --identifier <id>        Set Tauri bundle identifier (e.g. com.pawdiolab.desktop)
  --build                  Run "npm run tauri -- build" after metadata update
  --help                   Show this help
`);
}

function parseArgs(argv) {
  const options = {
    version: null,
    productName: null,
    identifier: null,
    build: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--build") {
      options.build = true;
      continue;
    }
    if (arg === "--version") {
      options.version = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--product-name") {
      options.productName = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--identifier") {
      options.identifier = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function assertArgValue(name, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
}

function isSemver(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

function updateCargoPackageVersion(cargoToml, version) {
  const packageBlockMatch = cargoToml.match(/\[package\][\s\S]*?(?=\r?\n\[|$)/);
  if (!packageBlockMatch) {
    throw new Error("Could not find [package] block in src-tauri/Cargo.toml");
  }

  const packageBlock = packageBlockMatch[0];
  if (!/^version\s*=.*$/m.test(packageBlock)) {
    throw new Error("Could not find package version in src-tauri/Cargo.toml");
  }

  const updatedPackageBlock = packageBlock.replace(
    /^version\s*=\s*"[^"]*"$/m,
    `version = "${version}"`
  );

  return cargoToml.replace(packageBlock, updatedPackageBlock);
}

function toPrettyJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    assertArgValue("--version", options.version);
    if (!isSemver(options.version)) {
      throw new Error(
        `Invalid version "${options.version}". Expected semantic version like 1.0.0`
      );
    }
  }
  if (options.productName) {
    assertArgValue("--product-name", options.productName);
  }
  if (options.identifier) {
    assertArgValue("--identifier", options.identifier);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const cargoToml = readFileSync(cargoTomlPath, "utf8");

  const originalProductName = tauriConfig.productName;
  const changes = [];

  if (options.version) {
    packageJson.version = options.version;
    tauriConfig.version = options.version;
    changes.push(`version -> ${options.version}`);
  }

  if (options.productName) {
    tauriConfig.productName = options.productName;
    changes.push(`productName -> ${options.productName}`);

    if (
      tauriConfig.app &&
      Array.isArray(tauriConfig.app.windows) &&
      tauriConfig.app.windows.length > 0
    ) {
      tauriConfig.app.windows = tauriConfig.app.windows.map((windowConfig) => {
        if (windowConfig.title === originalProductName) {
          return { ...windowConfig, title: options.productName };
        }
        return windowConfig;
      });
    }
  }

  if (options.identifier) {
    tauriConfig.identifier = options.identifier;
    changes.push(`identifier -> ${options.identifier}`);
  }

  if (changes.length > 0) {
    writeFileSync(packageJsonPath, toPrettyJson(packageJson), "utf8");
    writeFileSync(tauriConfigPath, toPrettyJson(tauriConfig), "utf8");

    if (options.version) {
      const updatedCargoToml = updateCargoPackageVersion(cargoToml, options.version);
      writeFileSync(cargoTomlPath, updatedCargoToml, "utf8");
    }
  }

  if (changes.length === 0) {
    console.log("No metadata changes requested.");
  } else {
    console.log(`Updated release metadata: ${changes.join(", ")}`);
  }

  if (options.build) {
    console.log("Starting Tauri bundle build...");
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npmCommand, ["run", "tauri", "--", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }
    if (typeof result.status === "number" && result.status !== 0) {
      process.exit(result.status);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`release-meta error: ${message}`);
  process.exit(1);
}
