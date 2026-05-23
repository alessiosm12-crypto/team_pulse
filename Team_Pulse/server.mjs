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
    const trimmed = line.replace(/^\uFEFF/, "").trim();
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
const surveysPath = join(dataDir, "surveys.local.json");
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
  try {
    await stat(surveysPath);
  } catch {
    await writeJson(surveysPath, []);
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

async function saveReport(markdown) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `team-pulse-report-${timestamp}.md`;
  const path = join(reportsDir, filename);
  await writeFile(path, markdown, "utf8");
  return filename;
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readSurveys() {
  return readJson(surveysPath, []);
}

async function writeSurveys(surveys) {
  await writeJson(surveysPath, surveys);
}

function publicSurvey(survey) {
  return {
    id: survey.id,
    teamName: survey.teamName,
    status: survey.status,
    createdAt: survey.createdAt,
    closedAt: survey.closedAt || null,
    responseCount: survey.responses.length,
  };
}

function matchSurveyRoute(pathname) {
  const match = pathname.match(/^\/api\/surveys\/([^/]+)(?:\/(responses|close))?$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] || null };
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      aiEnabled: false,
      aiConfigured: false,
      model: null,
    });
    return;
  }

  if (pathname === "/api/responses" && request.method === "GET") {
    sendJson(response, 200, { responses: await readJson(responsesPath, []) });
    return;
  }

  if (pathname === "/api/surveys" && request.method === "GET") {
    const surveys = await readSurveys();
    sendJson(response, 200, { surveys: surveys.map(publicSurvey) });
    return;
  }

  if (pathname === "/api/surveys" && request.method === "POST") {
    const body = await readBody(request);
    const teamName = String(body.teamName || "").trim();
    if (!teamName) {
      sendJson(response, 400, { error: "teamName is required" });
      return;
    }

    const surveys = await readSurveys();
    const survey = {
      id: createId(),
      teamName,
      status: "active",
      createdAt: new Date().toISOString(),
      closedAt: null,
      responses: [],
      actionItems: [],
    };
    surveys.unshift(survey);
    await writeSurveys(surveys);
    sendJson(response, 201, { survey: publicSurvey(survey) });
    return;
  }

  const surveyRoute = matchSurveyRoute(pathname);
  if (surveyRoute) {
    const surveys = await readSurveys();
    const survey = surveys.find((item) => item.id === surveyRoute.id);
    if (!survey) {
      sendJson(response, 404, { error: "Survey not found" });
      return;
    }

    if (!surveyRoute.action && request.method === "GET") {
      sendJson(response, 200, { survey });
      return;
    }

    if (surveyRoute.action === "responses" && request.method === "POST") {
      if (survey.status !== "active") {
        sendJson(response, 409, { error: "Survey is closed" });
        return;
      }
      const body = await readBody(request);
      const item = {
        id: createId(),
        teamName: survey.teamName,
        scores: body.scores || {},
        comments: body.comments || {},
        createdAt: new Date().toISOString(),
      };
      survey.responses.push(item);
      await writeSurveys(surveys);
      sendJson(response, 201, { survey: publicSurvey(survey), response: item });
      return;
    }

    if (surveyRoute.action === "close" && request.method === "POST") {
      survey.status = "closed";
      survey.closedAt = new Date().toISOString();
      await writeSurveys(surveys);
      sendJson(response, 200, { survey: publicSurvey(survey) });
      return;
    }
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
    sendJson(response, 503, {
      error: "AI analysis is disabled for the local prototype",
      aiEnabled: false,
    });
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
