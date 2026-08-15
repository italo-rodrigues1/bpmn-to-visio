import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDir = join(root, "work", "verification");
const input = join(root, "public", "samples", "pedido-de-compra.bpmn");
const converter = join(root, "converter", "bpmn_to_vsdx.py");
const output = join(outputDir, "pedido-de-compra.vsdx");

async function configuredPython() {
  if (process.env.BPMN_TO_VISIO_PYTHON) return process.env.BPMN_TO_VISIO_PYTHON;
  try {
    const envFile = await readFile(join(root, ".env.local"), "utf8");
    return envFile.match(/^BPMN_TO_VISIO_PYTHON=(.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function findPython() {
  const configured = await configuredPython();
  const candidates = [
    ...(configured ? [{ command: configured, prefix: [] }] : []),
    { command: "python", prefix: [] },
    { command: "python3", prefix: [] },
    { command: "py", prefix: ["-3"] },
  ];

  for (const candidate of candidates) {
    try {
      const result = await run(candidate.command, [...candidate.prefix, "--version"]);
      if (result.code === 0) return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("Python 3 não encontrado. Configure BPMN_TO_VISIO_PYTHON.");
}

const inspection = String.raw`
import json, sys, zipfile
from xml.etree import ElementTree as ET

path = sys.argv[1]
required = {
    '[Content_Types].xml',
    '_rels/.rels',
    'visio/document.xml',
    'visio/pages/pages.xml',
    'visio/pages/page1.xml',
}

with zipfile.ZipFile(path) as archive:
    names = set(archive.namelist())
    missing = sorted(required - names)
    page = ET.fromstring(archive.read('visio/pages/page1.xml'))
    shapes = sum(1 for element in page.iter() if element.tag.endswith('Shape'))
    print(json.dumps({'entries': len(names), 'shapes': shapes, 'missing': missing}))
    if missing or shapes == 0:
        raise SystemExit(1)
`;

try {
  const python = await findPython();
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const conversion = await run(python.command, [...python.prefix, converter, input, "-o", outputDir]);
  if (conversion.code !== 0) throw new Error(conversion.stderr || conversion.stdout || "O conversor falhou.");

  const check = await run(python.command, [...python.prefix, "-c", inspection, output]);
  if (check.code !== 0) throw new Error(check.stderr || check.stdout || "O VSDX não passou na inspeção estrutural.");

  const result = JSON.parse(check.stdout.trim());
  console.log(`✓ Conversão concluída: ${output}`);
  console.log(`✓ Pacote VSDX válido: ${result.entries} partes Open XML, ${result.shapes} shapes`);
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
