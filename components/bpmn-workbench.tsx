"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Code2,
  Download,
  FileCode2,
  FileDown,
  GitFork,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Modeler from "bpmn-js/lib/Modeler";
import type Canvas from "diagram-js/lib/core/Canvas";
import type CommandStack from "diagram-js/lib/command/CommandStack";
import styles from "@/app/page.module.css";

type ViewMode = "diagram" | "xml";
type Notice = { kind: "success" | "error"; message: string } | null;

const SUPPORTED_SHAPES = new Set([
  "startEvent", "endEvent", "intermediateCatchEvent", "intermediateThrowEvent",
  "boundaryEvent", "task", "userTask", "serviceTask", "scriptTask", "sendTask",
  "receiveTask", "manualTask", "businessRuleTask", "subProcess", "callActivity",
  "exclusiveGateway", "parallelGateway", "inclusiveGateway", "eventBasedGateway",
  "participant", "lane", "textAnnotation",
]);

const FLOW_TYPES = new Set(["sequenceFlow", "messageFlow", "association"]);
const KNOWN_LIMITATIONS = new Set([
  "group", "dataObject", "dataObjectReference", "dataStoreReference", "complexGateway", "transaction",
]);

function analyzeBpmn(xml: string) {
  const empty = { valid: false, shapes: 0, flows: 0, poolsAndLanes: 0, diShapes: 0, diEdges: 0, score: 0, unsupported: [] as string[] };
  if (typeof window === "undefined" || !xml) return empty;

  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    return { ...empty, unsupported: ["XML inválido"] };
  }

  const all = Array.from(document.getElementsByTagName("*"));
  const shapeElements = all.filter((element) => SUPPORTED_SHAPES.has(element.localName));
  const flowElements = all.filter((element) => FLOW_TYPES.has(element.localName));
  const limitations = new Set(
    all.filter((element) => KNOWN_LIMITATIONS.has(element.localName)).map((element) => element.localName),
  );

  for (const element of all.filter((item) => item.localName === "BPMNShape")) {
    if (element.getAttribute("isExpanded") === "false") limitations.add("subProcess recolhido");
  }

  const supported = shapeElements.length + flowElements.length;
  const unsupported = Array.from(limitations);
  const score = supported === 0 ? 0 : Math.round((supported / (supported + unsupported.length)) * 100);

  return {
    valid: document.documentElement.localName === "definitions",
    shapes: shapeElements.length,
    flows: flowElements.length,
    poolsAndLanes: shapeElements.filter((element) => ["participant", "lane"].includes(element.localName)).length,
    diShapes: all.filter((element) => element.localName === "BPMNShape").length,
    diEdges: all.filter((element) => element.localName === "BPMNEdge").length,
    score,
    unsupported,
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function fileStem(fileName: string) {
  return fileName.replace(/\.bpmn$/i, "").replace(/\.xml$/i, "") || "processo";
}

export function BpmnWorkbench() {
  const canvasElement = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const modeler = useRef<Modeler | null>(null);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [view, setView] = useState<ViewMode>("diagram");
  const [xml, setXml] = useState("");
  const [fileName, setFileName] = useState("pedido-de-compra.bpmn");
  const [ready, setReady] = useState(false);
  const [warnings, setWarnings] = useState(0);
  const [converting, setConverting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [dragging, setDragging] = useState(false);

  const report = useMemo(() => analyzeBpmn(xml), [xml]);

  const saveCurrentXml = useCallback(async () => {
    if (!modeler.current) return "";
    const result = await modeler.current.saveXML({ format: true, preamble: true });
    const currentXml = result.xml || "";
    setXml(currentXml);
    return currentXml;
  }, []);

  const importXml = useCallback(async (nextXml: string, nextName?: string) => {
    if (!modeler.current) return;
    setNotice(null);
    try {
      const result = await modeler.current.importXML(nextXml);
      setXml(nextXml);
      if (nextName) setFileName(nextName.endsWith(".bpmn") ? nextName : `${nextName}.bpmn`);
      setWarnings(result.warnings.length);
      modeler.current.get<Canvas>("canvas").zoom("fit-viewport");
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Não foi possível abrir este BPMN." });
    }
  }, []);

  const loadSample = useCallback(async () => {
    const response = await fetch("/samples/pedido-de-compra.bpmn");
    const sample = await response.text();
    await importXml(sample, "pedido-de-compra.bpmn");
  }, [importXml]);

  useEffect(() => {
    let disposed = false;

    async function initialize() {
      if (!canvasElement.current) return;
      const { default: BpmnModeler } = await import("bpmn-js/lib/Modeler");
      if (disposed || !canvasElement.current) return;

      const instance = new BpmnModeler({ container: canvasElement.current });
      modeler.current = instance;
      instance.on("commandStack.changed", () => {
        if (changeTimer.current) clearTimeout(changeTimer.current);
        changeTimer.current = setTimeout(() => void saveCurrentXml(), 180);
      });
      setReady(true);

      const response = await fetch("/samples/pedido-de-compra.bpmn");
      const sample = await response.text();
      if (!disposed) await importXml(sample, "pedido-de-compra.bpmn");
    }

    void initialize();
    return () => {
      disposed = true;
      if (changeTimer.current) clearTimeout(changeTimer.current);
      modeler.current?.destroy();
      modeler.current = null;
    };
  }, [importXml, saveCurrentXml]);

  async function readSourceFile(file: File) {
    if (!/\.(bpmn|xml)$/i.test(file.name)) {
      setNotice({ kind: "error", message: "Selecione um arquivo .bpmn ou .xml." });
      return;
    }
    await importXml(await file.text(), file.name);
  }

  async function changeView(nextView: ViewMode) {
    if (nextView === "xml") await saveCurrentXml();
    setView(nextView);
  }

  function zoom(multiplier: number) {
    if (!modeler.current) return;
    const canvas = modeler.current.get<Canvas>("canvas");
    canvas.zoom(Math.min(4, Math.max(0.2, canvas.zoom() * multiplier)));
  }

  function undo() {
    modeler.current?.get<CommandStack>("commandStack").undo();
  }

  async function downloadBpmn() {
    const currentXml = await saveCurrentXml();
    downloadBlob(new Blob([currentXml], { type: "application/xml;charset=utf-8" }), `${fileStem(fileName)}.bpmn`);
  }

  async function convertToVisio() {
    setConverting(true);
    setNotice(null);
    try {
      const currentXml = await saveCurrentXml();
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bpmnXml: currentXml, fileName }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(body.detail ? `${body.error} ${body.detail}` : body.error || "Falha na conversão.");
      }

      const blob = await response.blob();
      downloadBlob(blob, `${fileStem(fileName)}.vsdx`);
      setNotice({ kind: "success", message: `VSDX gerado com sucesso (${Math.max(1, Math.round(blob.size / 1024))} KB).` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha na conversão." });
    } finally {
      setConverting(false);
    }
  }

  const checks = [
    { ok: report.valid, label: "XML BPMN válido" },
    { ok: report.diShapes > 0 && report.diEdges > 0, label: "Coordenadas BPMNDI encontradas" },
    { ok: report.unsupported.length === 0, label: report.unsupported.length ? `${report.unsupported.length} limitação encontrada` : "Elementos compatíveis" },
  ];

  return (
    <main
      className={styles.app}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const [file] = Array.from(event.dataTransfer.files);
        if (file) void readSourceFile(file);
      }}
    >
      {dragging && (
        <div className={styles.dropOverlay}>
          <Upload size={30} />
          <strong>Solte o arquivo BPMN aqui</strong>
          <span>Abriremos o diagrama sem enviar o XML para terceiros.</span>
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark}>BV</span>
          <div><strong>BPMN → Visio Lab</strong><span>Conversor open source</span></div>
        </div>
        <div className={styles.headerActions}>
          <a href="https://github.com/Mgabr90/bpmn-to-visio" target="_blank" rel="noreferrer"><GitFork size={14} /> Projeto original</a>
          <div className={styles.headerMeta}><span className={styles.statusDot} /> Motor local</div>
        </div>
      </header>

      <section className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>POC DE FIDELIDADE</span>
          <h1>Do BPMN.js para um Visio realmente editável.</h1>
          <p>Modele ou importe um BPMN 2.0, valide sua estrutura e gere um `.vsdx` preservando formas, coordenadas, cores e conectores.</p>
        </div>
        <div className={styles.introActions}>
          <input
            ref={fileInput}
            className={styles.hiddenInput}
            type="file"
            accept=".bpmn,.xml,application/xml,text/xml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readSourceFile(file);
              event.target.value = "";
            }}
          />
          <button className={styles.secondaryButton} onClick={() => void loadSample()}><RotateCcw size={15} /> Restaurar exemplo</button>
          <button className={styles.primaryButton} onClick={() => fileInput.current?.click()}><Upload size={15} /> Importar BPMN</button>
        </div>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.stepHeader}><span>01</span><div><strong>Arquivo de origem</strong><small>BPMN 2.0 + BPMNDI</small></div></div>
          <button className={styles.fileCard} onClick={() => fileInput.current?.click()}>
            <span className={styles.fileIcon}><FileCode2 size={16} /></span>
            <span><strong>{fileName}</strong><small>{report.shapes} elementos · {report.flows} conexões</small></span>
            <ChevronRight size={14} />
          </button>
          <div className={styles.rule} />
          <span className={styles.sectionLabel}>PRÉ-VALIDAÇÃO</span>
          <ul className={styles.checks}>
            {checks.map((check) => (
              <li key={check.label} className={!check.ok ? styles.failedCheck : undefined}>
                <span>{check.ok ? <Check size={13} /> : <AlertTriangle size={13} />}</span>{check.label}
              </li>
            ))}
          </ul>
          {warnings > 0 && <p className={styles.warningText}>{warnings} aviso(s) do BPMN.js durante a importação.</p>}
          <div className={styles.rule} />
          <div className={styles.flowLegend}>
            <span><i className={styles.dotTeal} /> BPMN.js</span><ChevronRight size={12} />
            <span><i className={styles.dotCoral} /> conversor</span><ChevronRight size={12} />
            <span><i className={styles.dotInk} /> VSDX</span>
          </div>
        </aside>

        <div className={styles.editor}>
          <div className={styles.editorToolbar}>
            <div className={styles.tabs}>
              <button className={view === "diagram" ? styles.activeTab : undefined} onClick={() => void changeView("diagram")}><span>Diagrama</span></button>
              <button className={view === "xml" ? styles.activeTab : undefined} onClick={() => void changeView("xml")}><Code2 size={13} /><span>XML</span></button>
            </div>
            <div className={styles.canvasActions}>
              <button onClick={undo} title="Desfazer" aria-label="Desfazer"><RotateCcw size={14} /></button><span />
              <button onClick={() => zoom(0.85)} title="Diminuir zoom" aria-label="Diminuir zoom"><Minus size={14} /></button>
              <button onClick={() => zoom(1.15)} title="Aumentar zoom" aria-label="Aumentar zoom"><Plus size={14} /></button>
              <button onClick={() => modeler.current?.get<Canvas>("canvas").zoom("fit-viewport")} title="Ajustar à tela" aria-label="Ajustar à tela"><Maximize2 size={14} /></button>
            </div>
          </div>
          <div className={`${styles.canvasShell} ${view === "xml" ? styles.showXml : ""}`}>
            <div ref={canvasElement} className={styles.bpmnCanvas} aria-label="Editor BPMN" />
            <div className={styles.xmlEditor}>
              <textarea
                aria-label="XML BPMN"
                spellCheck={false}
                value={xml}
                onChange={(event) => setXml(event.target.value)}
                onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void importXml(xml); }}
              />
              <button onClick={() => void importXml(xml)}><Code2 size={14} /> Aplicar XML <kbd>Ctrl ↵</kbd></button>
            </div>
            {!ready && <div className={styles.canvasLoading}><LoaderCircle className={styles.spin} size={24} /> Preparando o editor…</div>}
          </div>
          <div className={styles.canvasFooter}><span>Editor BPMN.js {ready ? "pronto" : "carregando"}</span><span>{report.diShapes} formas e {report.diEdges} rotas no BPMNDI</span></div>
        </div>

        <aside className={styles.exportPanel}>
          <div className={styles.stepHeader}><span>02</span><div><strong>Exportar para Visio</strong><small>VSDX Open XML editável</small></div></div>
          <div className={styles.score}>
            <strong>{report.score}%</strong>
            <span>{report.unsupported.length ? `Revise: ${report.unsupported.join(", ")}.` : "dos elementos detectados são suportados pelo conversor."}</span>
          </div>
          <dl className={styles.stats}>
            <div><dt>Formas</dt><dd>{report.shapes}</dd></div><div><dt>Conectores</dt><dd>{report.flows}</dd></div><div><dt>Pools & lanes</dt><dd>{report.poolsAndLanes}</dd></div>
          </dl>
          <div className={styles.assurance}><ShieldCheck size={16} /><p><strong>Estrutura preservada</strong><span>Shapes e conectores permanecem editáveis no Visio.</span></p></div>
          <button className={styles.convertButton} disabled={converting || !report.valid || report.shapes === 0} onClick={() => void convertToVisio()}>
            {converting ? <LoaderCircle className={styles.spin} size={16} /> : <FileDown size={16} />}{converting ? "Gerando VSDX…" : "Gerar arquivo .VSDX"}
          </button>
          <button className={styles.downloadButton} onClick={() => void downloadBpmn()}><Download size={14} /> Baixar BPMN atual</button>
          <p className={styles.license}>Motor original `bpmn-to-visio` v1.1.1 · Licença MIT · sem Aspose</p>
        </aside>
      </section>

      {notice && (
        <div className={`${styles.notice} ${notice.kind === "error" ? styles.noticeError : ""}`} role="status">
          {notice.kind === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Fechar">×</button>
        </div>
      )}
    </main>
  );
}
