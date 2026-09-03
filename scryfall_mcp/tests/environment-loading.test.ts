import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxBinary = join(projectRoot, "node_modules", ".bin", "tsx");
const temporaryDirectories: string[] = [];

describe("entrypoint environment loading", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  });

  it.each([
    {
      name: "Node",
      command: process.execPath,
      args: ["--import", "dotenv/config"],
    },
    {
      name: "tsx",
      command: tsxBinary,
      args: ["--import", "dotenv/config"],
    },
  ])("preloads .env through the documented $name runtime", async ({ command, args }) => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "scryfall-mcp-env-"));
    temporaryDirectories.push(workingDirectory);
    const envPath = join(workingDirectory, ".env");
    await writeFile(
      envPath,
      "SCRYFALL_MCP_ENV_TEST=loaded-from-dotenv\n",
      "utf8"
    );

    const { SCRYFALL_MCP_ENV_TEST: _ignored, ...environment } = process.env;
    const commandArgs = [
      ...args,
      "--eval",
      'process.stdout.write(process.env.SCRYFALL_MCP_ENV_TEST ?? "missing")',
    ];
    const childEnvironment = {
      ...environment,
      DOTENV_CONFIG_PATH: envPath,
    };
    const { stdout } = await execFileAsync(command, commandArgs, {
      cwd: projectRoot,
      env: childEnvironment,
    });
    expect(stdout).toBe("loaded-from-dotenv");

    const explicitEnvironmentResult = await execFileAsync(command, commandArgs, {
      cwd: projectRoot,
      env: {
        ...childEnvironment,
        SCRYFALL_MCP_ENV_TEST: "explicit-process-value",
      },
    });
    expect(explicitEnvironmentResult.stdout).toBe("explicit-process-value");
  });

  it("preloads dotenv in every documented npm entrypoint", () => {
    const scripts = packageJson.scripts as Record<string, string>;

    for (const script of [
      "dev",
      "dev:http",
      "dev:http:local",
      "start",
      "start:http",
      "inspector",
    ]) {
      expect(scripts[script]).toContain("--import dotenv/config");
    }
  });
});
