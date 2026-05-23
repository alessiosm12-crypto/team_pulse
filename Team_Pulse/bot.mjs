import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBase = process.env.BOT_API_BASE || "http://localhost:3000";
const telegramApi = token ? `https://api.telegram.org/bot${token}` : null;

const QUESTIONS = [
  { id: "q1", text: "Мне понятно, какие цели и приоритеты сейчас являются главными для нашей команды." },
  { id: "q2", text: "Критерии успеха нашей работы понятны и не противоречат друг другу." },
  { id: "q3", text: "В команде понятно, кто за что отвечает и к кому обращаться по ключевым вопросам." },
  { id: "q4", text: "Текущая нагрузка команды выглядит устойчивой на горизонте ближайших недель." },
  { id: "q5", text: "У команды хватает времени и ресурса, чтобы работать качественно, а не только быстро." },
  { id: "q6", text: "Команда эффективно договаривается, обменивается информацией и решает спорные вопросы." },
  { id: "q7", text: "В команде можно открыто говорить о проблемах, ошибках и рисках." },
  { id: "q8", text: "Руководитель / РП дает достаточно ясности, обратной связи и поддержки." },
  { id: "q9", text: "Процессы помогают команде работать, а не создают лишние препятствия." },
  { id: "q10", text: "Сейчас я не вижу серьезных рисков для сроков, качества или устойчивости команды." },
];

const OPEN_QUESTIONS = [
  { id: "o1", text: "Что сейчас больше всего помогает команде работать эффективно?" },
  { id: "o2", text: "Что сейчас больше всего мешает команде работать спокойно и качественно?" },
  { id: "o3", text: "Какое одно действие руководителя или команды было бы самым полезным в ближайшие 2-4 недели?" },
];

const sessions = new Map();

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not configured. Add it to Team_Pulse/.env.");
  process.exit(1);
}

async function telegram(method, payload) {
  const response = await fetch(`${telegramApi}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Backend request failed: ${response.status}`);
  return data;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

async function answerCallback(callbackQueryId) {
  return telegram("answerCallbackQuery", { callback_query_id: callbackQueryId });
}

function scaleKeyboard(questionIndex) {
  return {
    reply_markup: {
      inline_keyboard: [
        [1, 2, 3, 4, 5].map((score) => ({
          text: String(score),
          callback_data: `score:${questionIndex}:${score}`,
        })),
      ],
    },
  };
}

async function startSurvey(chatId, surveyId) {
  const data = await apiRequest(`/api/surveys/${encodeURIComponent(surveyId)}`);
  const survey = data.survey;
  if (survey.status !== "active") {
    await sendMessage(chatId, "Этот опрос уже закрыт.");
    return;
  }

  sessions.set(chatId, {
    surveyId,
    teamName: survey.teamName,
    questionIndex: 0,
    openIndex: 0,
    scores: {},
    comments: {},
    mode: "scale",
  });

  await sendMessage(
    chatId,
    `Опрос команды: <b>${escapeHtml(survey.teamName)}</b>\n\nСвободные ответы могут попасть в отчет дословно. Ответьте на вопросы по шкале 1-5.`
  );
  await askScaleQuestion(chatId);
}

async function askScaleQuestion(chatId) {
  const session = sessions.get(chatId);
  if (!session) return;
  const question = QUESTIONS[session.questionIndex];
  await sendMessage(chatId, `${session.questionIndex + 1}/${QUESTIONS.length}\n${question.text}`, scaleKeyboard(session.questionIndex));
}

async function askOpenQuestion(chatId) {
  const session = sessions.get(chatId);
  if (!session) return;
  const question = OPEN_QUESTIONS[session.openIndex];
  await sendMessage(chatId, `${session.openIndex + 1}/${OPEN_QUESTIONS.length}\n${question.text}`);
}

async function finishSurvey(chatId) {
  const session = sessions.get(chatId);
  if (!session) return;

  await apiRequest(`/api/surveys/${encodeURIComponent(session.surveyId)}/responses`, {
    method: "POST",
    body: JSON.stringify({
      scores: session.scores,
      comments: session.comments,
    }),
  });

  sessions.delete(chatId);
  await sendMessage(chatId, "Спасибо, ответ сохранен.");
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (text === "/cancel") {
    sessions.delete(chatId);
    await sendMessage(chatId, "Опрос отменен.");
    return;
  }

  if (text.startsWith("/start")) {
    const [, surveyId] = text.split(/\s+/);
    if (!surveyId) {
      await sendMessage(chatId, "Откройте бота по ссылке запуска опроса или отправьте: /start survey_id");
      return;
    }
    try {
      await startSurvey(chatId, surveyId);
    } catch (error) {
      await sendMessage(chatId, `Не удалось открыть опрос: ${escapeHtml(error.message)}`);
    }
    return;
  }

  const session = sessions.get(chatId);
  if (!session) {
    await sendMessage(chatId, "Чтобы начать, откройте ссылку опроса или отправьте /start survey_id.");
    return;
  }

  if (session.mode === "open") {
    const question = OPEN_QUESTIONS[session.openIndex];
    session.comments[question.id] = text;
    session.openIndex += 1;

    if (session.openIndex >= OPEN_QUESTIONS.length) {
      await finishSurvey(chatId);
    } else {
      await askOpenQuestion(chatId);
    }
  }
}

async function handleCallback(callbackQuery) {
  await answerCallback(callbackQuery.id);
  const chatId = callbackQuery.message.chat.id;
  const session = sessions.get(chatId);
  if (!session) return;

  const [kind, rawIndex, rawScore] = callbackQuery.data.split(":");
  if (kind !== "score") return;

  const questionIndex = Number(rawIndex);
  const score = Number(rawScore);
  if (questionIndex !== session.questionIndex) return;

  const question = QUESTIONS[questionIndex];
  session.scores[question.id] = score;
  session.questionIndex += 1;

  if (session.questionIndex >= QUESTIONS.length) {
    session.mode = "open";
    await sendMessage(chatId, "Теперь три открытых вопроса. Ответы попадут в отчет дословно.");
    await askOpenQuestion(chatId);
  } else {
    await askScaleQuestion(chatId);
  }
}

async function poll() {
  let offset = 0;
  console.log("Team Pulse Telegram bot is running.");

  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
        if (update.callback_query) await handleCallback(update.callback_query);
      }
    } catch (error) {
      console.error(error.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

poll();
