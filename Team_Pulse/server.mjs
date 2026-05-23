import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ||= value;
  }
}

loadEnv();

const rootDir = resolve(__dirname);
const dataDir = join(rootDir, "data");
const reportsDir = join(rootDir, "reports");
const responsesPath = join(dataDir, "responses.local.json");
const promptPath = join(rootDir, "prompts", "analysis_prompt.md");
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function ensureStorage() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  try {
    await stat(responsesPath);
  } catch {
    await writeJson(responsesPath, []);
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(data));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

function getOutputText(apiResponse) {
  if (apiResponse.output_text) return apiResponse.output_text;
  const chunks = [];
  for (const item of apiResponse.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function callOpenAI({ prompt, payload }) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured");
    error.statusCode = 400;
    throw error;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: prompt,
      input: JSON.stringify(payload, null, 2),
      text: {
        format: {
          type: "text",
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `OpenAI API error: ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  const report = getOutputText(data);
  if (!report) {
    const error = new Error("OpenAI API returned an empty report");
    error.statusCode = 502;
    throw error;
  }
  return { report, model, responseId: data.id };
}

async function saveReport(markdown) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `team-pulse-report-${timestamp}.md`;
  const path = join(reportsDir, filename);
  await writeFile(path, markdown, "utf8");
  return filename;
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      aiConfigured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    });
    return;
  }

  if (pathname === "/api/responses" && request.method === "GET") {
    sendJson(response, 200, { responses: await readJson(responsesPath, []) });
    return;
  }

  if (pathname === "/api/responses" && request.method === "PUT") {
    const body = await readBody(request);
    const responses = Array.isArray(body.responses) ? body.responses : [];
    await writeJson(responsesPath, responses);
    sendJson(response, 200, { responses });
    return;
  }

  if (pathname === "/api/responses" && request.method === "POST") {
    const body = await readBody(request);
    const responses = await readJson(responsesPath, []);
    responses.push(body.response);
    await writeJson(responsesPath, responses);
    sendJson(response, 201, { responses });
    return;
  }

  if (pathname === "/api/responses" && request.method === "DELETE") {
    await writeJson(responsesPath, []);
    sendJson(response, 200, { responses: [] });
    return;
  }

  if (pathname === "/api/analyze" && request.method === "POST") {
    const body = await readBody(request);
    const responses = Array.isArray(body.responses) ? body.responses : await readJson(responsesPath, []);
    const prompt = await readFile(promptPath, "utf8");
    const payload = {
      generatedAt: new Date().toISOString(),
      responseCount: responses.length,
      responses,
      questions: body.questions || [],
      openQuestions: body.openQuestions || [],
    };

    const result = await callOpenAI({ prompt, payload });
    const reportFile = await saveReport(result.report);
    sendJson(response, 200, { ...result, reportFile });
    return;
  }

  sendJson(response, 404, { error: "API route not found" });
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(rootDir, normalized));

  if (!filePath.startsWith(rootDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) throw new Error("Not a file");
    response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

await ensureStorage();

createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }
    await serveStatic(request, response, url.pathname);
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "Server error" });
  }
}).listen(port, () => {
  console.log(`Team Pulse is running at http://localhost:${port}`);
});
