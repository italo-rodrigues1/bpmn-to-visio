import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BPMN_BYTES = 5 * 1024 * 1024;

type PythonCandidate = {
  command: string;
  prefixArgs: string[];
};

function safeBaseName(value: unknown) {
  const requested = typeof value === "string" ? basename(value) : "processo.bpmn";
  const cleaned = requested
    .replace(/\.bpmn$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "processo";
}

function pythonCandidates(): PythonCandidate[] {
  const configured = process.env.BPMN_TO_VISIO_PYTHON?.trim();
  return [
    ...(configured ? [{ command: configured, prefixArgs: [] }] : []),
    { command: "python", prefixArgs: [] },
    { command: "python3", prefixArgs: [] },
    { command: "py", prefixArgs: ["-3"] },
  ];
}

function runPython(candidate: PythonCandidate, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(candidate.command, [...candidate.prefixArgs, ...args], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

async function executeConverter(scriptPath: string, inputPath: string, outputDir: string) {
  let lastError: unknown;

  for (const candidate of pythonCandidates()) {
    try {
      const result = await runPython(candidate, [scriptPath, inputPath, "-o", outputDir]);
      return { ...result, command: candidate.command };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      lastError = error;
    }
  }

  throw Object.assign(new Error("Python 3 não foi encontrado no servidor."), {
    cause: lastError,
    code: "PYTHON_NOT_FOUND",
  });
}

export async function POST(request: Request) {
  let workDir: string | undefined;

  try {
    const body = (await request.json()) as { bpmnXml?: unknown; fileName?: unknown };
    if (typeof body.bpmnXml !== "string" || !body.bpmnXml.trim()) {
      return Response.json({ error: "Envie um XML BPMN não vazio." }, { status: 400 });
    }

    if (Buffer.byteLength(body.bpmnXml, "utf8") > MAX_BPMN_BYTES) {
      return Response.json({ error: "O arquivo excede o limite de 5 MB deste POC." }, { status: 413 });
    }

    if (!body.bpmnXml.includes("<") || !/definitions[\s>]/i.test(body.bpmnXml)) {
      return Response.json({ error: "O conteúdo não parece ser um documento BPMN 2.0." }, { status: 400 });
    }

    const baseName = safeBaseName(body.fileName);
    workDir = await mkdtemp(join(tmpdir(), "bpmn-visio-"));
    const inputPath = join(workDir, `${baseName}.bpmn`);
    const outputPath = join(workDir, `${baseName}.vsdx`);
    const converterPath = join(process.cwd(), "converter", "bpmn_to_vsdx.py");

    await writeFile(inputPath, body.bpmnXml, "utf8");
    const result = await executeConverter(converterPath, inputPath, workDir);

    let vsdx: Buffer;
    try {
      vsdx = await readFile(outputPath);
    } catch {
      const diagnostic = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      return Response.json(
        { error: "O conversor não conseguiu gerar o VSDX.", detail: diagnostic.slice(-3000) },
        { status: 422 },
      );
    }

    const responseBody = Uint8Array.from(vsdx).buffer;
    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-visio.drawing",
        "Content-Disposition": `attachment; filename="${parse(outputPath).base}"`,
        "Content-Length": String(vsdx.byteLength),
        "X-Converter-Engine": "bpmn-to-visio-1.1.1",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const isMissingPython = (error as { code?: string }).code === "PYTHON_NOT_FOUND";
    return Response.json(
      {
        error: isMissingPython
          ? "Python 3 não foi encontrado. Configure BPMN_TO_VISIO_PYTHON no servidor."
          : "Falha inesperada durante a conversão.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: isMissingPython ? 503 : 500 },
    );
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
