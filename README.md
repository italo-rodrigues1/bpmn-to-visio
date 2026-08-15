# BPMN → Visio Lab

Aplicação Next.js para modelar ou importar BPMN 2.0 e gerar arquivos Microsoft Visio `.vsdx` editáveis. O POC usa o editor oficial `bpmn-js` no navegador e, no servidor, o código original MIT do [`Mgabr90/bpmn-to-visio`](https://github.com/Mgabr90/bpmn-to-visio), versão 1.1.1.

## O que este POC valida

- importação por seletor ou arrastar e soltar de `.bpmn`/`.xml`;
- edição visual real com a paleta, context pad, atalhos e regras do BPMN.js;
- visualização e edição do XML BPMN 2.0;
- leitura de `BPMNShape`, `BPMNEdge`, `dc:Bounds`, waypoints e cores do BPMN.io;
- relatório imediato de elementos, conectores, pools/lanes e limitações conhecidas;
- geração e download de `.bpmn` e `.vsdx`;
- conversão temporária no servidor, sem persistir o XML enviado;
- inspeção automatizada da estrutura ZIP/Open XML gerada.

## Arquitetura

```text
BPMN.js (edição no navegador)
          │
          ▼
    BPMN 2.0 XML + BPMNDI  ← representação canônica
          │
          ▼
POST /api/convert (Next.js / Node.js)
          │
          ▼
bpmn-to-visio 1.1.1 (Python, código MIT incluído)
          │
          ▼
VSDX Open XML editável
```

O conversor original está preservado em `converter/bpmn_to_vsdx.py`, acompanhado de sua licença e atribuição. A rota Next.js apenas cria uma área temporária isolada, chama o conversor e devolve o binário; o diretório temporário é removido em seguida.

## Executar localmente

Requisitos:

- Node.js 20.9 ou superior;
- Python 3.7 ou superior;
- Microsoft Visio apenas para a validação manual final (não é necessário para gerar o arquivo).

Instale e inicie:

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). A aplicação tenta localizar `python`, `python3` ou `py -3`. Caso necessário, copie `.env.example` para `.env.local` e informe o executável:

```dotenv
BPMN_TO_VISIO_PYTHON=C:\Python313\python.exe
```

## Validar o conversor

```bash
npm run verify:converter
npm run build
```

O primeiro comando converte o BPMN de exemplo e verifica se o resultado contém as partes Open XML obrigatórias e shapes na página do Visio. O arquivo de inspeção fica em `work/verification/pedido-de-compra.vsdx`.

## Elementos cobertos pelo motor original

| Categoria | Elementos |
| --- | --- |
| Atividades | task, user/service/script/send/receive/manual/business-rule task, sub-process e call activity |
| Eventos | start, end, intermediate catch/throw e boundary |
| Gateways | exclusive, parallel, inclusive e event-based |
| Organização | participant/pool, lane e text annotation |
| Conexões | sequence flow, message flow e association |
| Fidelidade | bounds, waypoints, labels e `bioc:fill`/`bioc:stroke` |

Limitações atuais herdadas do projeto-base: ícones específicos de tipos de task não são desenhados, eventos intermediários são simplificados, grupos e data objects não são renderizados e sub-processos recolhidos não são suportados. A interface sinaliza esses casos antes da exportação.

## Roteiro de comparação com o Aspose

Use o mesmo `.bpmn` nas duas implementações e avalie:

1. fidelidade visual de posição, tamanho, cor e texto;
2. edição individual de tasks, gateways, eventos, pools e lanes no Visio;
3. edição dos conectores e preservação dos waypoints;
4. abertura no Visio Desktop e Visio Web sem reparo do arquivo;
5. comportamento com diagramas grandes e com elementos listados nas limitações;
6. diferença de tamanho dos arquivos e tempo de conversão.

## API

`POST /api/convert`

```json
{
  "fileName": "processo.bpmn",
  "bpmnXml": "<?xml version=\"1.0\"?>..."
}
```

A resposta de sucesso usa o tipo `application/vnd.ms-visio.drawing` e retorna o arquivo `.vsdx`. O limite deste POC é 5 MB por BPMN.

## Licenças

- aplicação POC: código deste repositório;
- `bpmn-js`: licença declarada pelo projeto BPMN.io;
- `converter/bpmn_to_vsdx.py`: MIT, Mahmoud Gabr; veja `converter/LICENSE` e `converter/NOTICE.md`.
