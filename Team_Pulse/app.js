const QUESTIONS = [
  { id: "q1", block: "Цели и фокус", text: "Мне понятно, какие цели и приоритеты сейчас являются главными для нашей команды." },
  { id: "q2", block: "Цели и фокус", text: "Критерии успеха нашей работы понятны и не противоречат друг другу." },
  { id: "q3", block: "Роли и ответственность", text: "В команде понятно, кто за что отвечает и к кому обращаться по ключевым вопросам." },
  { id: "q4", block: "Нагрузка и устойчивость", text: "Текущая нагрузка команды выглядит устойчивой на горизонте ближайших недель." },
  { id: "q5", block: "Нагрузка и устойчивость", text: "У команды хватает времени и ресурса, чтобы работать качественно, а не только быстро." },
  { id: "q6", block: "Коммуникация", text: "Команда эффективно договаривается, обменивается информацией и решает спорные вопросы." },
  { id: "q7", block: "Психологическая безопасность", text: "В команде можно открыто говорить о проблемах, ошибках и рисках." },
  { id: "q8", block: "Управление и поддержка", text: "Руководитель / РП дает достаточно ясности, обратной связи и поддержки." },
  { id: "q9", block: "Процессы и препятствия", text: "Процессы помогают команде работать, а не создают лишние препятствия." },
  { id: "q10", block: "Delivery-риски", text: "Сейчас я не вижу серьезных рисков для сроков, качества или устойчивости команды." },
];

const OPEN_QUESTIONS = [
  { id: "o1", text: "Что сейчас больше всего помогает команде работать эффективно?" },
  { id: "o2", text: "Что сейчас больше всего мешает команде работать спокойно и качественно?" },
  { id: "o3", text: "Какое одно действие руководителя или команды было бы самым полезным в ближайшие 2-4 недели?" },
];

const SAMPLE_RESPONSES = [
  {
    scores: { q1: 4, q2: 4, q3: 3, q4: 2, q5: 2, q6: 3, q7: 3, q8: 4, q9: 3, q10: 2 },
    comments: {
      o1: "Помогает то, что РП быстро принимает решения и не бросает нас с клиентом один на один.",
      o2: "Очень много параллельных задач, постоянно переключаемся. Есть ощущение, что релиз горит.",
      o3: "Нужно честно пересобрать приоритеты и снять часть задач до релиза.",
    },
  },
  {
    scores: { q1: 3, q2: 3, q3: 2, q4: 2, q5: 2, q6: 3, q7: 2, q8: 3, q9: 2, q10: 2 },
    comments: {
      o1: "Команда сильная, люди помогают друг другу и быстро подхватывают проблемы.",
      o2: "Не всегда понятно, кто финально отвечает за решения. Из-за этого спорим по кругу.",
      o3: "Зафиксировать роли и договориться, какие задачи точно не берем в текущий спринт.",
    },
  },
  {
    scores: { q1: 4, q2: 3, q3: 3, q4: 3, q5: 2, q6: 4, q7: 3, q8: 4, q9: 3, q10: 3 },
    comments: {
      o1: "Хорошо, что есть регулярные синки и РП на связи.",
      o2: "Качество страдает из-за спешки. Иногда тестирование сжимается до минимума.",
      o3: "Нужен короткий разговор про качество и реальные сроки.",
    },
  },
];

const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
const REPORT_KEY = "teamPulse.report.v2";

let backendAvailable = false;
let surveys = [];
let selectedSurvey = null;
let participantSurveyId = new URLSearchParams(window.location.search).get("survey");
let telegramBotUsername = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

async function loadSurveys() {
  try {
    const health = await apiRequest("/api/health");
    telegramBotUsername = health.telegramBotUsername || null;
    const data = await apiRequest("/api/surveys");
    backendAvailable = true;
    surveys = data.surveys || [];
    if (!selectedSurvey && surveys.length) await selectSurvey(surveys[0].id);
  } catch {
    backendAvailable = false;
    surveys = [];
  }
  renderSurveyList();
}

async function selectSurvey(id) {
  const data = await apiRequest(`/api/surveys/${encodeURIComponent(id)}`);
  selectedSurvey = data.survey;
  renderDashboard();
}

async function createSurvey(teamName) {
  const data = await apiRequest("/api/surveys", {
    method: "POST",
    body: JSON.stringify({ teamName }),
  });
  await loadSurveys();
  await selectSurvey(data.survey.id);
}

async function submitSurveyResponse(surveyId, response) {
  return apiRequest(`/api/surveys/${encodeURIComponent(surveyId)}/responses`, {
    method: "POST",
    body: JSON.stringify(response),
  });
}

function renderQuestions() {
  $("#scaleQuestions").innerHTML = QUESTIONS.map((question, index) => `
    <fieldset class="question">
      <legend class="question-title">${index + 1}. ${question.text}</legend>
      <div class="scale" role="radiogroup" aria-label="${escapeHtml(question.text)}">
        ${[1, 2, 3, 4, 5].map((score) => `
          <label title="${score}">
            <input type="radio" name="${question.id}" value="${score}" required />
            ${score}
          </label>
        `).join("")}
      </div>
    </fieldset>
  `).join("");

  $("#openQuestions").innerHTML = OPEN_QUESTIONS.map((question, index) => `
    <label class="field question">
      <span>${index + 1}. ${question.text}</span>
      <textarea name="${question.id}" required></textarea>
    </label>
  `).join("");
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function getSelectedResponses() {
  return selectedSurvey?.responses || [];
}

function analyzeResponses(responses) {
  const byBlock = {};
  QUESTIONS.forEach((question) => {
    byBlock[question.block] ||= [];
    responses.forEach((response) => {
      const value = Number(response.scores?.[question.id]);
      if (value) byBlock[question.block].push(value);
    });
  });

  const blockScores = Object.entries(byBlock).map(([block, values]) => {
    const avg = average(values);
    return {
      block,
      avg,
      signal: avg >= 4 ? "сильная сторона" : avg >= 3.3 ? "стабильно" : avg >= 2.7 ? "зона внимания" : "критичный риск",
    };
  });

  const totalAverage = average(blockScores.map((item) => item.avg));
  const weakBlocks = blockScores.filter((item) => item.avg < 3.3).sort((a, b) => a.avg - b.avg);
  const strongBlocks = blockScores.filter((item) => item.avg >= 4).sort((a, b) => b.avg - a.avg);
  const zone = totalAverage >= 4 && weakBlocks.length === 0 ? "Зеленая" : totalAverage >= 3.2 && weakBlocks.length <= 2 ? "Желтая" : "Красная";
  const confidence = responses.length >= 5 ? "средняя/высокая" : responses.length >= 2 ? "предварительная" : "низкая";

  return {
    totalAverage,
    blockScores,
    weakBlocks,
    strongBlocks,
    zone,
    confidence,
    comments: responses.flatMap((response, responseIndex) =>
      OPEN_QUESTIONS.map((question) => ({
        responseIndex: responseIndex + 1,
        question: question.text,
        text: response.comments?.[question.id] || "",
      })).filter((item) => item.text.trim())
    ),
  };
}

function renderSurveyList() {
  if (!backendAvailable) {
    $("#surveyList").innerHTML = `<div class="empty-state">Запустите локальный сервер, чтобы создавать опросы.</div>`;
    return;
  }

  if (!surveys.length) {
    $("#surveyList").innerHTML = `<div class="empty-state">Опросов пока нет.</div>`;
    return;
  }

  $("#surveyList").innerHTML = surveys.map((survey) => `
    <button class="survey-item ${selectedSurvey?.id === survey.id ? "active" : ""}" data-survey-id="${survey.id}" type="button">
      <strong>${escapeHtml(survey.teamName)}</strong>
      <span>${survey.responseCount} ${plural(survey.responseCount, ["ответ", "ответа", "ответов"])} · ${survey.status === "active" ? "активен" : "закрыт"}</span>
    </button>
  `).join("");
}

function surveyLink(surveyId) {
  return `${window.location.origin}${window.location.pathname}?survey=${encodeURIComponent(surveyId)}`;
}

function telegramSurveyLink(surveyId) {
  if (!telegramBotUsername) return null;
  return `https://t.me/${telegramBotUsername}?start=${encodeURIComponent(surveyId)}`;
}

function renderDashboard() {
  const responses = getSelectedResponses();
  $("#responseCount").textContent = `${responses.length} ${plural(responses.length, ["ответ", "ответа", "ответов"])}`;
  $("#dashboardSubhead").textContent = selectedSurvey
    ? `Выбран опрос: ${selectedSurvey.teamName}`
    : "Создайте запуск опроса или выберите существующий.";

  renderSurveyList();

  if (!selectedSurvey) {
    $("#shareBox").innerHTML = `<p>Нет выбранного опроса.</p>`;
    $("#metricsGrid").innerHTML = "";
    $("#blockTable").innerHTML = "";
    $("#commentList").innerHTML = "<p>Пока нет данных.</p>";
    return;
  }

  const link = surveyLink(selectedSurvey.id);
  const telegramLink = telegramSurveyLink(selectedSurvey.id);
  $("#shareBox").innerHTML = `
    <div>
      <strong>Ссылка для участников</strong>
      <p>${escapeHtml(link)}</p>
      ${telegramLink ? `<strong>Telegram</strong><p>${escapeHtml(telegramLink)}</p>` : ""}
    </div>
    <div class="button-row">
      <button class="secondary" id="copySurveyLinkBtn" type="button">Копировать web</button>
      ${telegramLink ? `<button class="secondary" id="copyTelegramLinkBtn" type="button">Копировать Telegram</button>` : ""}
    </div>
  `;

  if (!responses.length) {
    $("#metricsGrid").innerHTML = "";
    $("#blockTable").innerHTML = "";
    $("#commentList").innerHTML = "<p>Пока нет сохраненных ответов.</p>";
    return;
  }

  const analysis = analyzeResponses(responses);
  $("#metricsGrid").innerHTML = `
    <div class="metric"><span>Ответы</span><strong>${responses.length}</strong></div>
    <div class="metric"><span>Средний балл</span><strong>${analysis.totalAverage.toFixed(1)}</strong></div>
    <div class="metric"><span>Статус</span><strong class="${zoneClass(analysis.zone)}">${analysis.zone}</strong></div>
    <div class="metric"><span>Надежность</span><strong>${analysis.confidence}</strong></div>
  `;

  $("#blockTable").innerHTML = analysis.blockScores.map((item) => `
    <tr>
      <td>${item.block}</td>
      <td>${item.avg.toFixed(1)}</td>
      <td>${item.signal}</td>
    </tr>
  `).join("");

  $("#commentList").innerHTML = analysis.comments.map((comment) => `
    <div class="comment">
      <small>Ответ ${comment.responseIndex}: ${comment.question}</small>
      ${escapeHtml(comment.text)}
    </div>
  `).join("");
}

function buildReport() {
  const responses = getSelectedResponses();
  if (!selectedSurvey || !responses.length) return "# Team Pulse\n\nНет ответов для анализа.";

  const analysis = analyzeResponses(responses);
  const weak = analysis.weakBlocks.length
    ? analysis.weakBlocks.map((item) => `- ${item.block}: ${item.avg.toFixed(1)} (${item.signal})`).join("\n")
    : "- Критичных зон по закрытым вопросам не видно.";
  const strong = analysis.strongBlocks.length
    ? analysis.strongBlocks.map((item) => `- ${item.block}: ${item.avg.toFixed(1)}`).join("\n")
    : "- Явных сильных блоков 4.0+ пока нет.";
  const comments = analysis.comments.map((comment) => `> ${comment.text}`).join("\n\n");

  return `# Team Pulse: отчет по команде "${selectedSurvey.teamName}"

Дата формирования: ${new Date().toLocaleString("ru-RU")}
ID опроса: ${selectedSurvey.id}

## Общий статус

Статус команды: ${analysis.zone}
Средний балл: ${analysis.totalAverage.toFixed(1)} из 5
Количество ответов: ${responses.length}
Надежность вывода: ${analysis.confidence}

## 3 главных вывода

${topFindings(analysis).map((item) => `- ${item}`).join("\n")}

## Сильные стороны

${strong}

## Зоны риска

${weak}

## Рекомендуемые действия на 2-4 недели

${suggestActions(analysis).map((item) => `- ${item}`).join("\n")}

## Вопросы для обсуждения с командой

- Какие 1-2 препятствия сильнее всего влияют на качество и устойчивость работы?
- Что нужно перестать делать или отложить, чтобы снизить перегруз?
- Где команде нужна большая ясность: цели, роли, приоритеты, решения или процессы?
- Какой один договор можно принять уже на следующей встрече?

## Дословные комментарии

${comments || "Открытых комментариев нет."}
`;
}

function topFindings(analysis) {
  const findings = [];
  if (analysis.weakBlocks.length) findings.push(`Главная зона внимания: ${analysis.weakBlocks[0].block} (${analysis.weakBlocks[0].avg.toFixed(1)}).`);
  if (analysis.strongBlocks.length) findings.push(`Опора команды: ${analysis.strongBlocks[0].block} (${analysis.strongBlocks[0].avg.toFixed(1)}).`);
  findings.push(analysis.zone === "Красная" ? "Нужен быстрый разбор с HRBP и руководителем." : analysis.zone === "Желтая" ? "Есть напряжение, которое лучше разобрать до эскалации." : "Команда выглядит устойчивой.");
  if (analysis.confidence !== "средняя/высокая") findings.push("Выводы предварительные из-за малого количества ответов.");
  return findings.slice(0, 3);
}

function suggestActions(analysis) {
  const weakBlocks = analysis.weakBlocks.map((item) => item.block);
  const actions = [];
  if (weakBlocks.includes("Нагрузка и устойчивость")) actions.push("Пересобрать приоритеты и явно снять или отложить часть задач.");
  if (weakBlocks.includes("Роли и ответственность")) actions.push("Зафиксировать владельцев ключевых решений и зон ответственности.");
  if (weakBlocks.includes("Психологическая безопасность")) actions.push("Провести отдельный разговор о правилах обсуждения проблем без поиска виноватых.");
  if (weakBlocks.includes("Процессы и препятствия")) actions.push("Выбрать один процессный барьер и договориться, как убрать его в ближайший спринт.");
  if (weakBlocks.includes("Delivery-риски")) actions.push("Сверить сроки, риски качества и ожидания клиента с текущей фактической нагрузкой.");
  if (!actions.length) actions.push("Сохранить работающие практики и выбрать одну область для точечного улучшения.");
  return actions.slice(0, 4);
}

function renderReport(markdown) {
  $("#reportState").textContent = markdown ? "Отчет сформирован локально." : "Сформируйте отчет в рабочей области HRBP.";
  $("#reportOutput").textContent = markdown || "";
}

function configureParticipantMode() {
  if (!participantSurveyId) return;
  $$(".tab").forEach((tab) => {
    if (tab.dataset.tab !== "survey") tab.style.display = "none";
  });
  $("#loadSampleBtn").style.display = "none";
  $("#teamNameField").style.display = "none";
  $("#surveyTitle").textContent = "Пульс-опрос команды";
  $("#surveyHint").textContent = "Свободные ответы могут попасть в отчет дословно.";
}

async function loadParticipantSurvey() {
  if (!participantSurveyId) return;
  try {
    const data = await apiRequest(`/api/surveys/${encodeURIComponent(participantSurveyId)}`);
    selectedSurvey = data.survey;
    $("#teamName").value = selectedSurvey.teamName;
    $("#surveyTitle").textContent = `Опрос: ${selectedSurvey.teamName}`;
  } catch {
    $("#surveyForm").innerHTML = "<p>Опрос не найден или сервер недоступен.</p>";
  }
}

function zoneClass(zone) {
  if (zone === "Зеленая") return "zone-green";
  if (zone === "Желтая") return "zone-yellow";
  return "zone-red";
}

function plural(number, forms) {
  const n = Math.abs(number) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const temp = document.createElement("textarea");
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }
}

function switchTab(tabName) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  $$(".panel").forEach((panel) => panel.classList.remove("active"));
  $(`#${tabName}Panel`).classList.add("active");
}

function downloadMarkdown(markdown) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `team-pulse-report-${new Date().toISOString().slice(0, 10)}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function wireEvents() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

  $("#createSurveyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const teamName = new FormData(event.currentTarget).get("newSurveyTeamName").trim();
    await createSurvey(teamName);
    event.currentTarget.reset();
  });

  $("#surveyList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-survey-id]");
    if (button) await selectSurvey(button.dataset.surveyId);
  });

  $("#refreshSurveysBtn").addEventListener("click", loadSurveys);

  $("#shareBox").addEventListener("click", async (event) => {
    if (event.target.id === "copySurveyLinkBtn" && selectedSurvey) await copyText(surveyLink(selectedSurvey.id));
    if (event.target.id === "copyTelegramLinkBtn" && selectedSurvey) await copyText(telegramSurveyLink(selectedSurvey.id));
  });

  $("#surveyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const response = {
      scores: Object.fromEntries(QUESTIONS.map((question) => [question.id, Number(formData.get(question.id))])),
      comments: Object.fromEntries(OPEN_QUESTIONS.map((question) => [question.id, String(formData.get(question.id)).trim()])),
    };

    if (participantSurveyId) {
      await submitSurveyResponse(participantSurveyId, response);
      event.currentTarget.innerHTML = "<p>Спасибо, ответ сохранен.</p>";
      return;
    }

    if (!selectedSurvey) await createSurvey(formData.get("teamName").trim());
    await submitSurveyResponse(selectedSurvey.id, response);
    await selectSurvey(selectedSurvey.id);
    event.currentTarget.reset();
    $("#teamName").value = selectedSurvey.teamName;
    switchTab("dashboard");
  });

  $("#resetFormBtn").addEventListener("click", () => $("#surveyForm").reset());

  $("#loadSampleBtn").addEventListener("click", async () => {
    if (!selectedSurvey) await createSurvey("Проектная команда A");
    for (const response of SAMPLE_RESPONSES) await submitSurveyResponse(selectedSurvey.id, response);
    await selectSurvey(selectedSurvey.id);
    localStorage.removeItem(REPORT_KEY);
    renderReport("");
    switchTab("dashboard");
  });

  $("#buildReportBtn").addEventListener("click", () => {
    const report = buildReport();
    localStorage.setItem(REPORT_KEY, report);
    renderReport(report);
    switchTab("report");
  });

  $("#copyReportBtn").addEventListener("click", async () => copyText(localStorage.getItem(REPORT_KEY) || buildReport()));
  $("#downloadReportBtn").addEventListener("click", () => downloadMarkdown(localStorage.getItem(REPORT_KEY) || buildReport()));
}

async function init() {
  renderQuestions();
  wireEvents();
  configureParticipantMode();
  if (participantSurveyId) {
    await loadParticipantSurvey();
    return;
  }
  await loadSurveys();
  renderDashboard();
  renderReport(localStorage.getItem(REPORT_KEY) || "");
}

init();
