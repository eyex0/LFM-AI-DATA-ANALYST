import dotenv from "dotenv";
// Load local environment overrides (.env.local takes precedence over .env).
// In hosted environments (e.g. AI Studio) the API key is injected directly,
// so a missing file here is fine.
dotenv.config({ path: [".env.local", ".env"] });

import express from "express";
import path from "path";
import {
  createInteraction,
  streamInteraction,
  API_BASE_URL,
} from "./server/lib/agentClient.ts";
import { extractJsonBlocks } from "./server/lib/jsonExtractor.ts";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import * as XLSX from "xlsx";

async function getGcpAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
      },
    );
    if (res.ok) {
      const data: any = await res.json();
      return data.access_token || null;
    }
  } catch (err) {
    console.warn(
      "[getGcpAccessToken] Could not fetch token from metadata server:",
      err,
    );
  }
  return null;
}

function extractTarInMemory(tarBuffer: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    let isEnd = true;
    for (let i = 0; i < 512; i++) {
      if (tarBuffer[offset + i] !== 0) {
        isEnd = false;
        break;
      }
    }
    if (isEnd) break;

    let name = "";
    for (let i = 0; i < 100; i++) {
      const charCode = tarBuffer[offset + i];
      if (charCode === 0) break;
      name += String.fromCharCode(charCode);
    }
    name = name.trim();

    let sizeStr = "";
    for (let i = 124; i < 136; i++) {
      const charCode = tarBuffer[offset + i];
      if (charCode === 0 || charCode === 32) continue;
      sizeStr += String.fromCharCode(charCode);
    }
    const size = parseInt(sizeStr, 8);

    const typeflag = tarBuffer[offset + 156];
    const isRegularFile = typeflag === 0 || typeflag === 48;

    offset += 512; // skip header

    if (name && isRegularFile && !isNaN(size) && size > 0) {
      if (offset + size <= tarBuffer.length) {
        files[name] = tarBuffer.subarray(offset, offset + size);
      }
    }

    const paddedSize = Math.ceil(size / 512) * 512;
    offset += paddedSize;
  }

  return files;
}

function extractEnvironmentId(interaction: any): string | undefined {
  if (!interaction || typeof interaction !== "object") return undefined;
  const environment = interaction.environment;
  const candidates = [
    environment?.env_id,
    environment?.environment_id,
    environment?.id,
    environment?.name,
    interaction.environment_id,
    interaction.env_id,
  ];
  const value = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim(),
  );
  if (typeof value !== "string") return undefined;
  return value.replace(/^environments?\//, "").replace(/^environment-/, "");
}

function extractInteractionId(interaction: any): string | undefined {
  if (!interaction || typeof interaction !== "object") return undefined;
  const value =
    interaction.name || interaction.id || interaction.interaction_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type AgentSource =
  | { type: "inline"; content: string; target: string }
  | { type: "gcs"; source: string; target: string }
  | { type: "repository"; source: string; target: string };

function loadAgentFiles(dir: string, basePath: string): AgentSource[] {
  let files: AgentSource[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const targetPath = path.posix.join(basePath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(loadAgentFiles(fullPath, targetPath));
    } else {
      files.push({
        type: "inline",
        content: fs.readFileSync(fullPath, "utf-8"),
        target: targetPath,
      });
    }
  }
  return files;
}

const activeGenerations = new Map<string, AbortController>();

function cleanUpOldGenerations() {
  const outputDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) return;

  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours threshold
  const now = Date.now();

  try {
    const items = fs.readdirSync(outputDir);
    for (const item of items) {
      if (item.startsWith(".")) continue; // ignore hidden items
      const itemPath = path.join(outputDir, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        const age = now - stats.mtimeMs;
        if (age > maxAgeMs) {
          console.log(
            `[cleanup] Directory ${item} is older than 24 hours (${Math.round(age / 1000 / 60 / 60)} hrs). Deleting to prevent storage bloat.`,
          );
          try {
            fs.rmSync(itemPath, { recursive: true, force: true });
            const zipPath = `${itemPath}.zip`;
            if (fs.existsSync(zipPath)) {
              fs.unlinkSync(zipPath);
            }
          } catch (itemErr) {
            console.error(`[cleanup] Failed to delete ${itemPath}:`, itemErr);
          }
        }
      }
    }
  } catch (err) {
    console.error("[cleanup] Error cleaning up old generations:", err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Run initial cleanup on startup
  cleanUpOldGenerations();

  app.use(express.json({ limit: "50mb" }));
  app.use("/output", express.static(path.join(process.cwd(), "output")));

  // API routes FIRST
  app.post("/api/cancel-show", (req, res) => {
    const { generationId } = req.body;
    if (generationId && activeGenerations.has(generationId)) {
      console.log(`[cancel-show] Human requested abort for ${generationId}`);
      activeGenerations.get(generationId)?.abort();
      activeGenerations.delete(generationId);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Not found or already completed" });
    }
  });

  app.get("/api/download-proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      res.status(400).send("Missing url parameter");
      return;
    }
    try {
      const parsedUrl = new URL(targetUrl);
      if (!parsedUrl.hostname.endsWith("storage.googleapis.com") && !parsedUrl.hostname.endsWith("googleusercontent.com")) {
        res.status(403).send("Forbidden: Domain not allowed");
        return;
      }
      const response = await fetch(targetUrl);
      if (!response.ok) {
        res
          .status(response.status)
          .send(`Failed to fetch: ${response.statusText}`);
        return;
      }
      res.setHeader(
        "Content-Type",
        response.headers.get("Content-Type") || "application/octet-stream",
      );
      res.setHeader("Access-Control-Allow-Origin", "*");

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    } catch (err) {
      console.error("Download proxy failed:", err);
      res
        .status(500)
        .send(
          `Internal server error: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
  });

  const QUOTA_CACHE_FILE = path.join(
    process.cwd(),
    "output",
    "quota_cache.json",
  );
  const DEFAULT_QUOTA_LIMIT = 999999;

  function getQuotaLimit(): number {
    const limitStr = process.env.DAILY_QUOTA_LIMIT;
    if (limitStr) {
      const parsed = parseInt(limitStr, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    return DEFAULT_QUOTA_LIMIT;
  }

  function getTodayStr(): string {
    return new Date().toISOString().split("T")[0];
  }

  let isFirebaseAdminInitialized = false;

  function ensureFirebaseAdmin() {
    // Firebase is disabled
  }

  async function getUserHash(req: express.Request): Promise<string | null> {
    // Fallback during local development or unauthenticated preview testing
    return "dev-user-hash";
  }

  function getQuotaCount(userHash: string | null): number {
    if (!userHash) return 0;
    try {
      const outputDir = path.dirname(QUOTA_CACHE_FILE);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      if (fs.existsSync(QUOTA_CACHE_FILE)) {
        const data = fs.readFileSync(QUOTA_CACHE_FILE, "utf-8");
        const cache = JSON.parse(data);
        const cacheKey = `${getTodayStr()}_${userHash}`;
        return cache[cacheKey] || 0;
      }
    } catch (err) {
      console.error("Error reading quota cache:", err);
    }
    return 0;
  }

  function incrementQuotaCount(userHash: string | null): void {
    if (!userHash) return;
    try {
      const outputDir = path.dirname(QUOTA_CACHE_FILE);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      let cache: Record<string, number> = {};
      if (fs.existsSync(QUOTA_CACHE_FILE)) {
        try {
          const data = fs.readFileSync(QUOTA_CACHE_FILE, "utf-8");
          cache = JSON.parse(data);
        } catch (e) {
          console.error("Error parsing quota file cache on increment:", e);
        }
      }
      const cacheKey = `${getTodayStr()}_${userHash}`;
      cache[cacheKey] = (cache[cacheKey] || 0) + 1;
      fs.writeFileSync(
        QUOTA_CACHE_FILE,
        JSON.stringify(cache, null, 2),
        "utf-8",
      );
    } catch (err) {
      console.error("Error incrementing quota cache:", err);
    }
  }

  app.get("/api/quota", async (req, res) => {
    if (process.env.NODE_ENV !== "production") {
      return res.json({ used: 0, limit: 999999 });
    }
    const userHash = await getUserHash(req);
    const limit = getQuotaLimit();
    if (!userHash) {
      return res.json({ used: 0, limit });
    }
    const count = getQuotaCount(userHash);
    return res.json({ used: count, limit });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  });

  const uploadSingle = upload.single("file");

  app.post(
    "/api/upload",
    (req, res, next) => {
      uploadSingle(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
              return res
                .status(400)
                .json({
                  error: "File is too large. The maximum allowed size is 50MB.",
                });
            }
            return res
              .status(400)
              .json({ error: `Upload error: ${err.message}` });
          }
          return res
            .status(500)
            .json({
              error: err.message || "An unknown error occurred during upload.",
            });
        }
        next();
      });
    },
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const originalName = req.file.originalname;
        const isExcel = /\.(xlsx|xls)$/i.test(originalName);

        // Allow up to 10MB for Excel files and 2MB for raw CSV
        const MAX_SIZE = isExcel ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
        if (req.file.size > MAX_SIZE) {
          const limitMb = (MAX_SIZE / (1024 * 1024)).toFixed(0);
          return res.status(400).json({
            error: `File "${originalName}" is ${(req.file.size / (1024 * 1024)).toFixed(2)} MB, which exceeds the ${limitMb}MB inline limit. For files larger than ${limitMb}MB, please use the "Paste a GCS URI" option!`,
          });
        }

        if (isExcel) {
          try {
            const workbook = XLSX.read(req.file.buffer, {
              type: "buffer",
              cellDates: true,
              dateNF: "yyyy-mm-dd",
            });
            const sheetNames = workbook.SheetNames || [];
            if (sheetNames.length === 0) {
              return res.status(400).json({ error: `Excel workbook "${originalName}" contains no worksheets.` });
            }

            const baseName = originalName.replace(/\.(xlsx|xls)$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_");
            const convertedFiles: Array<{ name: string; content: string; size: number }> = [];

            for (const sheetName of sheetNames) {
              const worksheet = workbook.Sheets[sheetName];
              if (!worksheet) continue;
              const csv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
              if (!csv || !csv.trim()) continue;

              const cleanSheetName = sheetName.replace(/[^a-zA-Z0-9._-]/g, "_");
              const fileName = sheetNames.length === 1
                ? `${baseName}.csv`
                : `${baseName}_${cleanSheetName}.csv`;

              convertedFiles.push({
                name: fileName,
                content: csv,
                size: Buffer.byteLength(csv, "utf-8"),
              });
            }

            if (convertedFiles.length === 0) {
              return res.status(400).json({ error: `Excel workbook "${originalName}" contained no readable data rows.` });
            }

            console.log(
              `[api/upload] Converted Excel workbook "${originalName}" into ${convertedFiles.length} table(s): ${convertedFiles.map(f => f.name).join(", ")}`,
            );

            return res.json({
              files: convertedFiles,
              name: convertedFiles[0].name,
              content: convertedFiles[0].content,
              size: convertedFiles[0].size,
            });
          } catch (excelErr: any) {
            console.error(`[api/upload] Excel parsing failed for ${originalName}:`, excelErr);
            return res.status(400).json({ error: `Failed to parse Excel file: ${excelErr.message || excelErr}` });
          }
        }

        // Standard CSV processing
        const content = req.file.buffer.toString("utf-8");
        const safeOriginalName = originalName.replace(
          /[^a-zA-Z0-9._-]/g,
          "_",
        );
        let gsUri: string | undefined = undefined;
        let url: string | undefined = undefined;

        console.log(
          `[api/upload] Processed inline CSV upload for ${safeOriginalName} (${req.file.size} bytes)`,
        );
        return res.json({
          name: originalName,
          content,
          size: req.file.size,
          gsUri,
          url,
        });
      } catch (err: any) {
        console.error("[api/upload] File upload failed:", err);
        res
          .status(500)
          .json({ error: `Upload failed: ${err.message || err}` });
      }
    },
  );

  async function deleteGcsFiles(files: any[]) {
    // Disabled
  }

  app.get("/api/download-file", async (req, res) => {
    return res.status(500).send("GCS bucket is not configured on Firebase Admin");
  });

  app.post("/api/clear-files", async (req, res) => {
    return res.json({ success: true });
  });

  app.post("/api/analyze", async (req, res) => {
    // Run background cleanup whenever a new analysis is requested to optimize disk space
    cleanUpOldGenerations();

    const {
      question,
      files,
      datasetName = "Dataset",
      generationId,
      environmentId,
      googleToken,
    } = req.body;

    if (!question || typeof question !== "string" || question.trim() === "") {
      return res
        .status(400)
        .json({ error: "Missing required field: question" });
    }

    // Reusing the environment is sufficient. Do not chain to the prior
    // interaction because the report can be retrieved before that interaction
    // has formally completed in the hosted runtime.
    const isFollowUp = !!environmentId;
    const uploadedFiles: Array<{ name: string; content?: string; gsUri?: string }> =
      Array.isArray(files)
        ? files.filter(
            (f: any) =>
              f &&
              typeof f.name === "string" &&
              ((typeof f.content === "string" && f.content.trim() !== "") ||
                (typeof f.gsUri === "string" && f.gsUri.trim() !== "")),
          )
        : [];
    if (!isFollowUp && uploadedFiles.length === 0) {
      return res.status(400).json({ error: "Provide at least one CSV file." });
    }

    console.log(`[analyze] Skipping daily quota tracking as requested.`);

    const effectiveDatasetName = datasetName;

    const gcsFiles = uploadedFiles.filter((f) => f.gsUri);
    const hasGcsFiles = gcsFiles.length > 0;
    let gcsToken: string | null = null;
    let gcsInstructions = "";
    if (hasGcsFiles) {
      gcsToken = await getGcpAccessToken();
      gcsInstructions = `The user uploaded ${gcsFiles.length} file(s) to Google Cloud Storage. First, you MUST run \`python /.agents/download_gcs.py\` to download them to /.agents/data/ before doing anything else.`;
    }

    const agentsMdPath = path.join(process.cwd(), "agent", "AGENTS.md");
    const agentsMarkdown = fs.existsSync(agentsMdPath)
      ? fs.readFileSync(agentsMdPath, "utf-8")
      : "";

    let prompt = "";

    if (isFollowUp) {
      prompt = `${agentsMarkdown}

==================================================
CURRENT FOLLOW-UP TASK:
Dataset: "${effectiveDatasetName}"
Follow-up Question: ${question}

FOLLOW-UP RULES (from AGENTS.md):
- Follow-up turns are execution-only. Your first response MUST be one code_execution call.
- Do not narrate a plan, restate instructions, output proposed script as text, or make preliminary tool calls.
- In that one call:
  1. Discover source files dynamically with \`glob.glob('./workspace/data/*.csv')\`.
  2. Clear prior files under \`./workspace/data/analysis/\` and \`./workspace/charts/\`, but preserve source CSVs and \`./workspace/data/profile.json\`.
  3. Analyze the follow-up question with Pandas and save result tables to \`./workspace/data/analysis/*.csv\`.
  4. Render charts with: \`python3 /.agents/skills/visualization/scripts/make_chart.py --workspace ./workspace --data data/analysis/<name>.csv --type <bar|line|scatter|pie|heatmap> --x <col> --y <col> --title "<Title>" --output charts/<chart_name>.png\`
  5. If the data cannot answer the question, write \`./workspace/data/analysis/limitations.csv\` with columns \`limitation\`, \`detail\`, and \`required_data\`.
  6. ALWAYS finish by running:
     \`python3 /.agents/skills/reporting/scripts/build_report.py --workspace ./workspace --question "${question.replace(/"/g, '\\"')}" --dataset-name "${effectiveDatasetName.replace(/"/g, '\\"')}"\`
- After "Report saved" appears in tool output, conclude immediately with a brief summary (do NOT include markdown links or file:// URLs).`;
    } else {
      const fileNames = uploadedFiles.map((f) => f.name).join(", ");
      const dataSourceInstructions = `The user provided ${uploadedFiles.length} CSV file(s). ${gcsInstructions} The files are staged at /.agents/data/. Copy them into ./workspace/data/: \`cp /.agents/data/*.csv ./workspace/data/\`. Provided file(s): ${fileNames}.`;

      prompt = `${agentsMarkdown}

==================================================
CURRENT INITIAL ANALYSIS TASK:
Dataset Name: "${effectiveDatasetName}"
Data Source: ${dataSourceInstructions}
Business Question: ${question}

MANDATORY WORKFLOW (Strictly follow AGENTS.md):
Hard execution budget: at most 10 code-execution calls for the entire analysis.
Do not ask for approval or print plans as text before executing.

1. STAGE & SET UP:
   mkdir -p ./workspace/data ./workspace/charts ./workspace/data/analysis && \\
   cp /.agents/data/*.csv ./workspace/data/ && \\
   pip install -r /.agents/requirements.txt --break-system-packages --prefer-binary --no-cache-dir

2. EXPLORE:
   Write and run one concise Pandas profiling script that inspects every CSV in ./workspace/data/ and writes ./workspace/data/profile.json matching the schema from /.agents/skills/data-explorer/SKILL.md.

3. ANALYZE:
   Write and execute a Python pandas script to perform calculations, aggregations, and metrics needed to answer the question.
   CRITICAL: Save result tables to ./workspace/data/analysis/*.csv.

4. VISUALIZE:
   Render clear PNG charts for your key findings using the visualization script:
   python3 /.agents/skills/visualization/scripts/make_chart.py --workspace ./workspace --data data/analysis/<your_csv>.csv --type <bar|line|scatter|pie|heatmap> --x <col> --y <col> --title "<Chart Title>" --output charts/<chart_name>.png

5. BUILD REPORT:
   Compile the final interactive report JSON:
   python3 /.agents/skills/reporting/scripts/build_report.py --workspace ./workspace --question "${question.replace(/"/g, '\\"')}" --dataset-name "${effectiveDatasetName.replace(/"/g, '\\"')}"

6. CONCLUDE:
   Once "Report saved" appears, immediately conclude your turn. When providing your final summary, do NOT include markdown links or file:// URLs to the generated files or scripts; use plain file names.`;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    let reportDelivered = false;
    let streamFailed = false;
    const sendError = (message: string) => {
      streamFailed = true;
      sendEvent({ type: "error", message });
    };
    let sentSessionEnvironmentId: string | undefined;
    const sendSessionEnvironment = (environmentIdValue: string | undefined) => {
      if (
        !environmentIdValue ||
        environmentIdValue === sentSessionEnvironmentId
      )
        return;
      sentSessionEnvironmentId = environmentIdValue;
      sendEvent({ type: "session", environmentId: environmentIdValue });
    };
    sendSessionEnvironment(
      typeof environmentId === "string" ? environmentId : undefined,
    );

    // Send a heartbeat every 15 seconds to keep the connection alive
    // (useful for proxies like VS Code port forwarding that drop idle connections)
    const heartbeatInterval = setInterval(() => {
      res.write(`:\n\n`); // SSE comment/ping
    }, 15000);

    let isFinished = false;
    const abortController = new AbortController();

    if (generationId) {
      activeGenerations.set(generationId, abortController);
    }

    req.on("aborted", () => {
      if (!isFinished) {
        console.log(
          `[analyze] Client aborted request. Agent will continue running in background unless explicitly cancelled.`,
        );
      }
      clearInterval(heartbeatInterval);
    });
    req.on("close", () => {
      clearInterval(heartbeatInterval);
    });

    try {
      let agentFiles: AgentSource[] = [];
      if (isFollowUp) {
        console.log(
          `[analyze] Continuing session in active environment: "${environmentId}" without interaction chaining.`,
        );
        sendEvent({
          type: "info",
          message: "Continuing session in active environment...",
        });
      } else {
        console.log(
          `[analyze] Request received. dataset: "${effectiveDatasetName}", source: ${uploadedFiles.length} uploaded file(s), question: "${question.substring(0, 80)}...", generationId: "${generationId}"`,
        );
        console.log(
          `[analyze] GEMINI_API_KEY presence verified: ${!!process.env.GEMINI_API_KEY}`,
        );
        sendEvent({
          type: "info",
          message: "Provisioning analysis environment...",
        });

        console.log(
          `[analyze] Loading agent files from filesystem path: ${path.join(process.cwd(), "agent")}`,
        );
        agentFiles = loadAgentFiles(
          path.join(process.cwd(), "agent"),
          "/.agents",
        );

        if (agentsMarkdown) {
          agentFiles.push({
            type: "inline",
            content: agentsMarkdown,
            target: "/AGENTS.md",
          });
          agentFiles.push({
            type: "inline",
            content: agentsMarkdown,
            target: "./AGENTS.md",
          });
        }

        // Add user dataset files (inline CSVs or GCS URIs)
        uploadedFiles.forEach((f) => {
          const safeName = path.posix
            .basename(f.name)
            .replace(/[^a-zA-Z0-9._-]/g, "_");
          if (f.content) {
            agentFiles.push({
              type: "inline",
              content: f.content,
              target: `/.agents/data/${safeName}`,
            });
          } else if (f.gsUri) {
            agentFiles.push({
              type: "gcs",
              source: f.gsUri,
              target: "/.agents/data",
            });
          }
        });

        // Uploads are fetched from GCS inside the sandbox via /.agents/download_gcs.py.
        if (hasGcsFiles) {
          const protocol = req.headers["x-forwarded-proto"] || "http";
          const host = req.headers.host || "localhost:3000";
          const serverUrl = `${protocol}://${host}`;

          const gcsFilesToDownload = gcsFiles.map((f) => {
            const safeName = path.posix
              .basename(f.name)
              .replace(/[^a-zA-Z0-9._-]/g, "_");
            let gcsPath = "";
            const uri = f.gsUri || "";
            if (uri.startsWith("gs://")) {
              const parts = uri.slice(5).split("/", 1);
              gcsPath = uri.slice(5 + parts[0].length + 1);
            }
            return {
              source: f.gsUri,
              filename: gcsPath,
              target: `/.agents/data/${safeName}`,
            };
          });

          const gcsDownloadScript = `
import urllib.request
import urllib.parse
import os


files = [
${gcsFilesToDownload.map((f) => `    {"source": "${f.source}", "filename": "${f.filename}", "target": "${f.target}"}`).join(",\n")}
]


server_url = "${serverUrl}"
token = ${gcsToken ? `"${gcsToken}"` : "None"}
os.makedirs("/.agents/data", exist_ok=True)


for f in files:
   filename = f["filename"]
   # 1. First attempt: Download via the secure local Express download proxy (works without direct GCS access or public permission)
   proxy_url = f"{server_url}/api/download-file?filename={urllib.parse.quote(filename)}"
   print(f"Attempting download for {filename} via proxy: {proxy_url}")
   try:
       req = urllib.request.Request(proxy_url)
       with urllib.request.urlopen(req) as response, open(f["target"], "wb") as out:
           out.write(response.read())
       print(f"Successfully downloaded {filename} via Express proxy")
       continue
   except Exception as proxy_err:
       print(f"Express proxy download failed: {proxy_err}. Falling back to direct GCS download...")


   # 2. Second attempt / fallback: Direct GCS API download
   uri = f["source"]
   if uri.startswith("gs://"):
       parts = uri[5:].split("/", 1)
       bucket = parts[0]
       obj = parts[1]
       encoded_obj = urllib.parse.quote(obj)
       url_json = f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encoded_obj}?alt=media"
       url_xml = f"https://storage.googleapis.com/{bucket}/{encoded_obj}"
      
       success = False
       for url in [url_json, url_xml]:
           req = urllib.request.Request(url)
           if token:
               req.add_header("Authorization", "Bearer " + token)
           try:
               with urllib.request.urlopen(req) as response, open(f["target"], "wb") as out:
                   out.write(response.read())
               print(f"Successfully downloaded {f['source']} from {url}")
               success = True
               break
           except Exception as e:
               print(f"Failed download from {url}: {e}")
       if not success:
           print(f"Failed all download attempts for {f['source']}")
`;
          agentFiles.push({
            type: "inline",
            content: gcsDownloadScript,
            target: `/.agents/download_gcs.py`,
          });
        }
        console.log(
          `[analyze] Finished loading agent files (source: ${uploadedFiles.length} uploaded file(s)). Count: ${agentFiles.length}`,
        );
      }

      if (!gcsToken) {
        gcsToken = await getGcpAccessToken();
      }
      console.log(
        `[analyze] Retrieved GCS access token: ${gcsToken ? "yes (length: " + gcsToken.length + ")" : "no"}`,
      );

      console.log(
        `[analyze] Calling createInteraction with prompt: "${prompt.substring(0, 100)}..."`,
      );
      const response = await createInteraction({
        prompt,
        stream: true,
        inlineSources: isFollowUp
          ? undefined
          : agentFiles.length > 0
            ? agentFiles
            : undefined,
        environmentId: isFollowUp ? environmentId : undefined,
        gcsToken: gcsToken || undefined,
        signal: abortController.signal,
      });

      console.log(
        `[analyze] Gemini API responded. HTTP Status: ${response.status} ${response.statusText}`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[analyze] Gemini API Non-2xx response. Error Payload: ${errorText}`,
        );

        let displayMessage = `Agent API error: ${response.status} - ${errorText}`;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed?.error?.message) {
            displayMessage = parsed.error.message;
          }
        } catch (e) {
          // ignore parsing error, stick to default
        }

        const isQuotaError =
          response.status === 429 ||
          errorText.toLowerCase().includes("quota") ||
          errorText.toLowerCase().includes("too_many_requests") ||
          errorText.toLowerCase().includes("resource_exhausted") ||
          displayMessage.toLowerCase().includes("quota") ||
          displayMessage.toLowerCase().includes("too_many_requests");

        const isEnvNotFoundError =
          response.status === 404 ||
          errorText.toLowerCase().includes("not_found") ||
          errorText.toLowerCase().includes("environment not found") ||
          displayMessage.toLowerCase().includes("environment not found") ||
          displayMessage.toLowerCase().includes("not found or not accessible");

        if (isQuotaError) {
          displayMessage = `Gemini API Quota Limit Reached: ${displayMessage}. The shared free-tier Google Gemini API Key has run out of request quota. To resolve this, go to Settings > Secrets inside AI Studio to verify your personal Gemini API key or set up billing.`;
        } else if (isEnvNotFoundError) {
          displayMessage = `The previous analysis session has expired or the remote environment has been recycled due to inactivity. Please start a fresh analysis session by uploading your CSV files again.`;
        }

        sendError(displayMessage);
        res.end();
        return;
      }

      console.log(
        `[analyze] Response remains ok. Constructing SSE stream reader...`,
      );
      let accumulatedText = "";
      let envId: string | undefined = environmentId;
      let interactionId: string | undefined;
      let reportArtifactReady = false;

      let eventCount = 0;
      for await (const event of streamInteraction(response)) {
        eventCount++;
        console.log(
          `[analyze] SSE yields streaming event #${eventCount}: type="${event.type}"`,
        );
        if (event.type === "done") {
          console.log(
            `[analyze] Received explicit "done" marker from interaction stream.`,
          );
          break;
        }
        if (event.type === "interaction") {
          envId = extractEnvironmentId(event.interaction) || envId;
          interactionId =
            extractInteractionId(event.interaction) || interactionId;
          sendSessionEnvironment(envId);
          console.log(
            `[analyze] Interaction created. Environment ID: "${envId}", interaction ID: "${interactionId}"`,
          );
        }
        if (event.type === "complete") {
          envId = extractEnvironmentId(event.interaction) || envId;
          interactionId =
            extractInteractionId(event.interaction) || interactionId;
          sendSessionEnvironment(envId);
          console.log(
            `[analyze] Interaction completed. Extracted environment ID: "${envId}"`,
          );
          const usage = event.interaction?.usage as any;
          if (usage) {
            console.log(
              `[agent] Token usage: ${usage.total_tokens} total tokens (${usage.total_input_tokens} input, ${usage.total_output_tokens} output, ${usage.total_thought_tokens || 0} thought, ${usage.total_cached_tokens || 0} cached)`,
            );
          }

          // Fallback extraction: iterate and combine text from all elements of the steps array
          const stepsObj = event.interaction?.steps as any[];
          if (Array.isArray(stepsObj)) {
            let combinedStepsText = "";
            for (const step of stepsObj) {
              const isReasoningStep =
                step.type === "thinking" ||
                step.type === "thought" ||
                step.type === "reasoning";
              if (!isReasoningStep && Array.isArray(step.content)) {
                for (const part of step.content) {
                  if (part && typeof part === "object") {
                    if (part.type === "text" && part.text) {
                      combinedStepsText += part.text;
                    } else if (part.text && part.type !== "thought") {
                      combinedStepsText += part.text;
                    }
                  } else if (typeof part === "string") {
                    combinedStepsText += part;
                  }
                }
              }
            }
            if (
              combinedStepsText &&
              combinedStepsText.length > accumulatedText.length
            ) {
              console.log(
                `[analyze] Dynamic steps recovery: Reconstructed text of length ${combinedStepsText.length} exceeds accumulated text of length ${accumulatedText.length}. Restoring fallback text.`,
              );
              accumulatedText = combinedStepsText;
            }
          }
        }

        // Log events to the terminal as well
        if (event.type === "thinking")
          console.log(
            `[agent] thinking delta: ${event.text?.substring(0, 30)}...`,
          );
        else if (event.type === "tool_call") {
          console.log(`[agent] tool_call: ${event.name}`);
          console.log(
            `[agent] args:`,
            JSON.stringify(event.arguments, null, 2),
          );
        } else if (event.type === "tool_result") {
          console.log(`[agent] tool_result for tool: ${event.name}`);
          if (
            event.result?.includes("Report saved to") &&
            event.result.includes("report.json")
          ) {
            reportArtifactReady = true;
            console.log(
              "[analyze] Agent confirmed report.json was saved in the sandbox.",
            );
          }
        } else if (event.type === "text") {
          console.log(
            `[agent] text output segment: ${event.text?.substring(0, 30)}...`,
          );
        }

        sendEvent(event);

        if (event.type === "text" && event.text) {
          accumulatedText += event.text;
        }
        if (reportArtifactReady && envId) {
          console.log(
            "[analyze] report.json is ready; stopping stream consumption and retrieving the sandbox snapshot.",
          );
          break;
        }
      }

      // If the hosted SSE connection closed before interaction.completed,
      // recover the environment ID from the interaction resource itself.
      if (!envId && interactionId) {
        try {
          const interactionPath = interactionId.startsWith("interactions/")
            ? interactionId
            : `interactions/${interactionId}`;
          const interactionRes = await fetch(
            `${API_BASE_URL}/${interactionPath}`,
            {
              headers: {
                "x-goog-api-key": process.env.GEMINI_API_KEY || "",
                "Api-Revision": "2026-05-20",
                "x-goog-api-client": "applet-ai-data-analyst/1.0.0",
              },
            },
          );
          if (interactionRes.ok) {
            const interactionData = await interactionRes.json();
            envId = extractEnvironmentId(interactionData);
            sendSessionEnvironment(envId);
            console.log(
              `[analyze] Recovered environment ID from interaction resource: "${envId}"`,
            );
          } else {
            console.warn(
              `[analyze] Could not recover interaction metadata: ${interactionRes.status} ${interactionRes.statusText}`,
            );
          }
        } catch (metadataErr) {
          console.warn(
            "[analyze] Interaction metadata recovery failed:",
            metadataErr,
          );
        }
      }

      // Fallback: if the agent emitted the report JSON inline in its text output, parse it.
      if (accumulatedText) {
        try {
          const blocks = extractJsonBlocks(accumulatedText);
          const reportBlock = blocks
            .reverse()
            .find(
              (b: any) =>
                b &&
                typeof b === "object" &&
                (b.executive_summary || b.insights || b.title),
            );
          if (reportBlock) {
            reportDelivered = true;
            sendEvent({ type: "report_data", data: reportBlock });
          }
        } catch (e) {
          console.error(
            "Failed to parse JSON blocks fallback from accumulated text:",
            e,
          );
        }
      }

      if (envId) {
        sendEvent({
          type: "info",
          message: reportArtifactReady
            ? "Report created. Retrieving dashboard files..."
            : "Retrieving report and charts from the analysis environment...",
        });
        try {
          const downloadUrl = `${API_BASE_URL}/files/environment-${envId}:download?alt=media`;
          let res: Response | null = null;
          for (let attempt = 1; attempt <= 5; attempt++) {
            res = await fetch(downloadUrl, {
              headers: { "x-goog-api-key": process.env.GEMINI_API_KEY || "" },
            });
            if (
              res.ok ||
              ![404, 409, 425].includes(res.status) ||
              attempt === 5
            )
              break;
            console.log(
              `[analyze] Environment snapshot not ready (attempt ${attempt}/5). Retrying...`,
            );
            await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          }

          if (res?.ok) {
            const arrayBuffer = await res.arrayBuffer();
            const tarBuffer = Buffer.from(arrayBuffer);
            const extractedFiles = extractTarInMemory(tarBuffer);

            let report: any = null;
            // Map of chart basename -> chart image URL
            const chartImages: Record<string, string> = {};

            // Prepare run directory for chart image output
            let runId = "gen-" + Math.random().toString(36).substring(2, 10);
            if (typeof generationId === "string" && /^[A-Za-z0-9_-]+$/.test(generationId)) {
              runId = generationId;
            }
            const outputDirRoot = path.join(process.cwd(), "output");
            let chartRunDir = path.join(outputDirRoot, runId, "charts");
            if (fs.existsSync(chartRunDir)) {
              runId = `${runId}-${Date.now()}`;
              chartRunDir = path.join(outputDirRoot, runId, "charts");
            }
            fs.mkdirSync(chartRunDir, { recursive: true });

            for (const [filePath, fileContent] of Object.entries(
              extractedFiles,
            )) {
              const normalized = filePath.replace(/^\.\//, "");
              if (
                normalized.endsWith("data/report.json") ||
                normalized.endsWith("/report.json") ||
                normalized === "report.json"
              ) {
                try {
                  report = JSON.parse(fileContent.toString("utf8"));
                } catch (err) {
                  console.error(
                    "Failed to parse report.json from memory:",
                    err,
                  );
                }
              } else if (
                normalized.includes("charts/") &&
                /\.(png|jpg|jpeg)$/i.test(normalized)
              ) {
                let base = normalized.split("/").pop() as string;
                if (!/^[A-Za-z0-9_.-]+\.(png|jpe?g)$/i.test(base)) {
                  const ext = base.split(".").pop() || "png";
                  base = `chart-${Object.keys(chartImages).length + 1}.${ext}`;
                }
                const targetFilePath = path.join(chartRunDir, base);
                try {
                  fs.writeFileSync(targetFilePath, fileContent);
                  chartImages[base] = `/output/${runId}/charts/${base}`;
                } catch (writeErr) {
                  console.error(`Failed to write chart ${base} to disk:`, writeErr);
                }
              }
            }

            const reportMatchesCurrentQuestion =
              typeof report?.question === "string" &&
              report.question.trim().toLowerCase() ===
                question.trim().toLowerCase();
            if (
              isFollowUp &&
              !reportArtifactReady &&
              !reportMatchesCurrentQuestion
            ) {
              console.warn(
                "[analyze] Follow-up stream ended without producing a replacement report. Preserving the existing dashboard.",
              );
              sendError(
                "The follow-up analysis stopped before it could update the dashboard. Your previous report has been preserved; please try the question again.",
              );
              return;
            }

            if (!report) {
              console.log(
                "[analyze] report.json was not found in the tar archive. Generating server-side fallback report...",
              );
              const displayTables: any[] = [];

              for (const [filePath, fileContent] of Object.entries(
                extractedFiles,
              )) {
                const normalized = filePath.replace(/^\.\//, "");
                if (
                  normalized.endsWith(".csv") &&
                  !normalized.includes("data/report.json")
                ) {
                  try {
                    const csvText = fileContent.toString("utf8");
                    const lines = csvText
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean);
                    if (lines.length > 0) {
                      const headers = lines[0]
                        .split(",")
                        .map((h) => h.replace(/^["']|["']$/g, ""));
                      const rows = lines.slice(1, 21).map((line) => {
                        return line
                          .split(",")
                          .map((val) => val.replace(/^["']|["']$/g, ""));
                      });
                      const filename =
                        normalized.split("/").pop() || "table.csv";
                      const title = filename
                        .replace(/\.csv$/i, "")
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase());
                      displayTables.push({
                        title,
                        columns: headers,
                        rows,
                        caption: `Generated data table: ${filename}`,
                      });
                    }
                  } catch (csvErr) {
                    console.error(
                      `Failed to parse csv fallback for ${normalized}:`,
                      csvErr,
                    );
                  }
                }
              }

              if (
                displayTables.length > 0 ||
                Object.keys(chartImages).length > 0 ||
                accumulatedText
              ) {
                let summary =
                  "The data analyst has finished processing your calculations.";
                if (accumulatedText) {
                  summary = accumulatedText
                    .replace(/```json[\s\S]*?```/g, "")
                    .trim();
                  if (summary.length > 500) {
                    summary = summary.substring(0, 500) + "...";
                  }
                }

                report = {
                  dataset_name: effectiveDatasetName || "Dataset",
                  question: question,
                  title: `Analysis Report: ${effectiveDatasetName || "Dataset"}`,
                  executive_summary: summary,
                  insights: [
                    {
                      title: "Calculations Completed",
                      detail:
                        "The analysis successfully completed the necessary Python computations. Explore the generated data tables and supporting documents below.",
                      metric: "Status",
                      value: "Success",
                    },
                  ],
                  charts: [],
                  tables: displayTables,
                  methodology:
                    "Computed using Pandas inside the sandboxed data analyst workspace.",
                  recommendations: [
                    "Review the structured output tables and charts below for specific metrics.",
                  ],
                  generated_at: new Date().toISOString().split("T")[0],
                };
              }
            }

            if (report) {
              // Embed chart image data into the referenced chart entries by matching basename.
              if (Array.isArray(report.charts)) {
                for (const chart of report.charts) {
                  if (
                    chart &&
                    typeof chart === "object" &&
                    typeof chart.file === "string"
                  ) {
                    const base = chart.file.split("/").pop() as string;
                    if (chartImages[base]) {
                      chart.image = chartImages[base];
                    }
                  }
                }
              }

              // Append any rendered charts the report didn't explicitly reference.
              const referenced = new Set(
                (Array.isArray(report.charts) ? report.charts : [])
                  .map((c: any) =>
                    typeof c?.file === "string"
                      ? c.file.split("/").pop()
                      : null,
                  )
                  .filter(Boolean),
              );
              const extras = Object.keys(chartImages)
                .filter((base) => !referenced.has(base))
                .map((base) => ({
                  title: base.replace(/\.[^.]+$/, "").replace(/_/g, " "),
                  file: `charts/${base}`,
                  caption: "",
                  type: "bar",
                  image: chartImages[base],
                }));
              if (extras.length > 0) {
                report.charts = [
                  ...(Array.isArray(report.charts) ? report.charts : []),
                  ...extras,
                ];
              }

              reportDelivered = true;
              sendEvent({ type: "report_data", data: report });
            } else {
              console.error(
                "report.json was not found in the extracted tar archive",
              );
              sendError("The analysis ran but report.json was not produced.");
            }
          } else {
            const errBody = res ? await res.text() : "No response received";
            console.error("Failed to download snapshot:", errBody);
            let displayMessage = `Failed to retrieve files from the analysis environment: ${errBody}`;
            try {
              const parsed = JSON.parse(errBody);
              if (parsed?.error?.message) {
                const msg = parsed.error.message.toLowerCase();
                if (
                  msg.includes("not found") ||
                  msg.includes("not accessible")
                ) {
                  displayMessage =
                    "The previous analysis session has expired or the remote environment has been recycled due to inactivity. Please start a fresh analysis session by uploading your CSV files again.";
                } else {
                  displayMessage = parsed.error.message;
                }
              }
            } catch (e) {
              if (
                errBody.toLowerCase().includes("not found") ||
                errBody.toLowerCase().includes("not accessible")
              ) {
                displayMessage =
                  "The previous analysis session has expired or the remote environment has been recycled due to inactivity. Please start a fresh analysis session by uploading your CSV files again.";
              }
            }
            sendError(displayMessage);
          }
        } catch (err: any) {
          console.error("Error processing snapshot in memory:", err);
          sendError(`Error extracting analysis files: ${err.message}`);
        }
      }

      isFinished = true;
      if (!reportDelivered && !streamFailed) {
        sendError(
          "The analysis stream ended before a dashboard report was produced.",
        );
      }
      if (reportDelivered && !streamFailed) {
        sendEvent({ type: "status", status: "completed" });
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log(`[analyze] Agent interaction aborted successfully.`);
      } else {
        console.error(`[analyze] Error:`, err);
        sendError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      isFinished = true;
      clearInterval(heartbeatInterval);
      if (generationId) {
        activeGenerations.delete(generationId);
      }
      res.end();

      // Files are kept for follow-up chats. They are only deleted when clicking "New Analysis" (POST /api/clear-files).
      /*
     if (!isFollowUp && uploadedFiles.length > 0) {
       deleteGcsFiles(uploadedFiles).catch(err => {
         console.error("[analyze] Error in background deleteGcsFiles:", err);
       });
     }
     */
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development (with a robust fallback to dev middleware if dist/index.html is missing)
  const distPath = path.join(process.cwd(), "dist");
  const indexHtmlExists = fs.existsSync(path.join(distPath, "index.html"));

  if (process.env.NODE_ENV !== "production" || !indexHtmlExists) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "Production mode enabled, but dist/index.html not found. Falling back to Vite dev server middleware to ensure app stays operational.",
      );
    }
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    // Express 5 format for catch-all (if using express 5) or Express 4. Let's use *all for v5 or * for v4.
    // We can use default express 4 catch-all
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const startListening = (port: number) => {
    const server = app
      .listen(port, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${port}`);
      })
      .on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.log(`Port ${port} is in use, trying ${port + 1}...`);
          startListening(port + 1);
        } else {
          console.error(err);
        }
      });

    // Disable timeouts for long-running agent interactions
    server.setTimeout(0);
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.keepAliveTimeout = 0;
  };

  startListening(PORT);
}

startServer();
