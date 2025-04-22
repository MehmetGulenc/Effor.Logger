// --- START OF FILE EfforLogger/js/background.js ---
"use strict";

const SETTINGS_STORAGE_KEY = 'effortLogger_Settings_v1';
const NOTIFICATION_ALARM_NAME = "effortLogReminder";
const JIRA_ISSUE_FETCH_TIMEOUT = 20000;
const JIRA_SUMMARY_FETCH_TIMEOUT = 10000;
const JIRA_SEARCH_TIMEOUT = 15000; // Added timeout for search
const AI_CALL_TIMEOUT = 30000;
const JIRA_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/i; // Regex for full Jira key


async function getSettings() {
    try {
        const result = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
        if (chrome.runtime.lastError) {
             console.error("BG: storage.sync.get error:", chrome.runtime.lastError.message);
             return {};
        }
        const settings = result?.[SETTINGS_STORAGE_KEY] || {};
        settings.colorPalette = settings.colorPalette || {};
        settings.jiraUrl = settings.jiraUrl || '';
        settings.jiraEmail = settings.jiraEmail || '';
        settings.jiraToken = settings.jiraToken || '';
        settings.aiModel = settings.aiModel || '';
        settings.aiKey = settings.aiKey || '';
        settings.showAIChat = settings.showAIChat ?? false;
        settings.reminderEnabled = settings.reminderEnabled ?? false;
        return settings;
    } catch (e) {
        console.error("BG: Unexpected error in getSettings:", e);
        return {};
    }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`Background: Mesaj alındı - Eylem: ${request?.action}, Gönderen:`, sender?.tab?.id ? `Tab ${sender.tab.id}` : (sender?.id || 'bilinmiyor'));
    console.log("Background: Tam mesaj içeriği:", request);

    try {
        switch (request.action) {
            case "openLogPage":
                console.log("Background: openLogPage işleniyor");
                handleOpenLogPage();
                break;

            case "updateReminderSchedule":
                console.log("Background: updateReminderSchedule işleniyor");
                handleUpdateReminderSchedule(request.enabled);
                break;

            case "getJiraSummary":
                console.log("Background: getJiraSummary işleniyor");
                if (request.issueKey) {
                    (async () => {
                        try {
                            const response = await handleGetJiraSummary(request.issueKey);
                            if (typeof sendResponse === 'function') sendResponse(response);
                            else console.error("BG (getJiraSummary): sendResponse fonksiyon değil!");
                        } catch (e) {
                            console.error("BG (getJiraSummary): Hata!", e);
                            if (typeof sendResponse === 'function') sendResponse({ success: false, error: `İşlem hatası: ${e.message}` });
                        }
                    })();
                    return true; // Async yanıt
                } else {
                    console.warn("BG: getJiraSummary için issueKey eksik.");
                    if (typeof sendResponse === 'function') sendResponse({ success: false, error: "Issue key eksik." });
                    return false;
                }

            case "callAI":
                console.log("Background: callAI işleniyor");
                if (request.body && request.apiKey && request.model) {
                    (async () => {
                        try {
                            const response = await handleCallAI(request.body, request.apiKey, request.model);
                            if (typeof sendResponse === 'function') sendResponse(response);
                             else console.error("BG (callAI): sendResponse fonksiyon değil!");
                        } catch (e) {
                            console.error("BG (callAI): Hata!", e);
                            if (typeof sendResponse === 'function') sendResponse({ success: false, error: `İşlem hatası: ${e.message}` });
                        }
                    })();
                    return true; // Async yanıt
                } else {
                    console.warn("BG: callAI için eksik parametre.");
                    if (typeof sendResponse === 'function') sendResponse({ success: false, error: "AI istek verisi eksik." });
                    return false;
                }

             case "searchJiraIssues": // Yeni case
                 console.log("Background: searchJiraIssues işleniyor");
                 if (request.searchTerm) {
                     (async () => {
                         try {
                             const response = await handleSearchJiraIssues(request.searchTerm);
                             if (typeof sendResponse === 'function') sendResponse(response);
                             else console.error("BG (searchJiraIssues): sendResponse fonksiyon değil!");
                         } catch (e) {
                             console.error("BG (searchJiraIssues): Hata!", e);
                             if (typeof sendResponse === 'function') sendResponse({ success: false, error: `Arama işlemi hatası: ${e.message}` });
                         }
                     })();
                     return true; // Async yanıt
                 } else {
                     console.warn("BG: searchJiraIssues için searchTerm eksik.");
                     if (typeof sendResponse === 'function') sendResponse({ success: false, error: "Arama terimi eksik." });
                     return false;
                 }

            case "ping": // Ping case korunuyor
                console.log("Background: Ping alındı");
                if (typeof sendResponse === 'function') sendResponse({ pong: true, time: new Date().toISOString() });
                else console.error("BG (ping): sendResponse fonksiyon değil!");
                break; // Ping sync olduğu için break kullanabiliriz

            // fetchRecentJiraIssues case'i kaldırıldı

            default:
                console.warn("Background: İşlenmeyen mesaj eylemi:", request.action);
                if (typeof sendResponse === 'function') sendResponse({ success: false, error: `Bilinmeyen eylem: ${request.action}` });
                return false;
        }
    } catch (e) {
        console.error("Background: Mesaj işlerken hata:", e);
        if (typeof sendResponse === 'function') { try { sendResponse({ success: false, error: `Mesaj işleme hatası: ${e.message}` }); } catch (ie) {} }
        return false;
    }
    // Switch içindeki async olmayan case'ler buraya düşerse false döner
    return false;
});


function handleOpenLogPage() {
    console.log("BG: handleOpenLogPage");
    const logPageUrl = chrome.runtime.getURL("html/log.html");
    chrome.tabs.query({ url: logPageUrl }, (tabs) => {
        if (chrome.runtime.lastError) { console.error("BG Tab query error:", chrome.runtime.lastError); chrome.tabs.create({ url: logPageUrl }); return; }
        if (tabs.length > 0) { chrome.tabs.update(tabs[0].id, { active: true }); if (tabs[0].windowId) chrome.windows.update(tabs[0].windowId, { focused: true }); }
        else { chrome.tabs.create({ url: logPageUrl }); }
    });
}

function handleUpdateReminderSchedule(enabled) {
    console.log(`BG: handleUpdateReminderSchedule. Enabled: ${enabled}`);
    scheduleEndOfDayReminder(enabled);
}

async function handleGetJiraSummary(issueKey) {
    console.log(`BG: handleGetJiraSummary for ${issueKey}.`);
    let responseData = { success: false, error: "Özet alınırken hata." };
    try {
        const settings = await getSettings();
        if (!settings?.jiraUrl || !settings.jiraEmail || !settings.jiraToken) { responseData.error = "[Jira Ayarları Eksik]"; return responseData; }
        const summaryData = await fetchJiraIssueSummary(issueKey, settings);
        responseData = summaryData.error ? { success: false, error: summaryData.summary } : { success: true, data: summaryData };
    } catch (error) { console.error("BG handleGetJiraSummary error:", error); responseData.error = error.message || "Beklenmedik Jira özeti hatası."; }
    console.log("BG Returning response for getJiraSummary:", responseData);
    return responseData;
}

async function handleCallAI(requestBody, apiKey, model) {
    console.log("BG: handleCallAI");
    let responseData = { success: false, error: "AI isteği hatası." };
    try {
        if (!apiKey || !model) throw new Error("AI modeli/anahtarı eksik.");
        let apiEndpoint = model; if (apiEndpoint && !apiEndpoint.startsWith('http')) apiEndpoint = `https://api.openai.com/v1/chat/completions`;
        requestBody.model = model;
        const response = await fetch(apiEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(AI_CALL_TIMEOUT) });
        let responseJson; try { responseJson = await response.json(); } catch (e) { if (!response.ok) throw new Error(`AI API JSON parse edilemedi: HTTP ${response.status}`); responseJson = {}; }
        if (!response.ok) { const errorMsg = responseJson?.error?.message || responseJson?.message || `HTTP ${response.status}`; throw new Error(`AI API Hatası: ${errorMsg}`); }
        if (!responseJson?.choices?.[0]?.message?.content) throw new Error("AI API yanıt yapısı beklenmedik.");
        responseData = { success: true, data: responseJson };
    } catch (error) { console.error("BG Error calling AI:", error); responseData.error = error.name === 'AbortError' ? `AI API Zaman Aşımı (${AI_CALL_TIMEOUT/1000}s)` : (error.message || "AI API hatası."); }
    console.log("BG Returning response for callAI:", responseData);
    return responseData;
}

// Yeni Handler Fonksiyonu
async function handleSearchJiraIssues(searchTerm) {
    console.log("BG: handleSearchJiraIssues çalıştırılıyor");
    let responseData = { success: false, error: "Jira issue arama hatası." };
    try {
        const settings = await getSettings();
        if (!settings?.jiraUrl || !settings.jiraEmail || !settings.jiraToken) { 
            console.warn("BG (handleSearchJiraIssues): Jira ayarları eksik."); 
            responseData.error = "Jira Ayarları Eksik"; 
            return responseData; 
        }

        const escapedTerm = searchTerm.replace(/"/g, '\\"'); // JQL için escape
        let jql = '';

        // JQL Oluşturma Mantığı (düzeltilmiş)
        if (JIRA_KEY_REGEX.test(escapedTerm)) {
             // Tam issue key ise ona göre ara
             jql = `issueKey = "${escapedTerm.toUpperCase()}" ORDER BY updated DESC`;
        } else if (/^[A-Z][A-Z0-9]+-?$/.test(escapedTerm)) {
             // Sadece proje anahtarı veya proje anahtarı + tire ise
             const projectKey = escapedTerm.replace(/-$/, '').toUpperCase();
             // Kullanıcıya atanmış o projedeki son güncellenenleri getir
             jql = `project = "${projectKey}" AND assignee = currentUser() ORDER BY updated DESC`;
        } else {
             // Diğer tüm durumlar için (örn. SO12, "toplantı") 
             // issueKey için "=" operatörünü kullan, text için "~" operatörünü kullan
             
             // issueKey için contains operatörü kullanılmaz, o yüzden text araması yeterli
             jql = `text ~ "${escapedTerm}*" AND assignee = currentUser() ORDER BY updated DESC`;
             
             // Alternatif olarak, sayısal arama için issue ID filtrelemesi ekleyebiliriz
             // Örneğin: "SO-123" gibi tam eşleşme olmayan ama sayısal kısım içeren aramalar için
             /*
             const numericPart = escapedTerm.match(/\d+/);
             if (numericPart) {
                 jql = `(text ~ "${escapedTerm}*" OR issueKey = "${searchTerm.toUpperCase()}") AND assignee = currentUser() ORDER BY updated DESC`;
             } else {
                 jql = `text ~ "${escapedTerm}*" AND assignee = currentUser() ORDER BY updated DESC`;
             }
             */
        }

        const maxResults = 10; // Arama sonuç limiti
        console.log(`BG: Jira araması için JQL: ${jql}`);

        // Mevcut fetchJiraIssues fonksiyonunu kullan
        responseData = await fetchJiraIssues(settings, jql, maxResults);

    } catch (error) { 
        console.error("BG handleSearchJiraIssues error:", error); 
        responseData.error = `Beklenmedik arama hatası: ${error.message}`; 
    }
    console.log("BG handleSearchJiraIssues'dan dönen yanıt:", responseData);
    return responseData;
}


// Çalışan fetchJiraIssueSummary fonksiyonu (Değişiklik yok)
async function fetchJiraIssueSummary(issueKey, settings) {
    console.log(`BG (fetchJiraIssueSummary): Özet alınıyor ${issueKey}`);
    const baseUrl = settings.jiraUrl.replace(/\/$/, ""); if (!baseUrl.startsWith('http')) return { key: issueKey, summary: `[Geçersiz URL: ${baseUrl}]`, error: true };
    const apiUrl = `${baseUrl}/rest/api/3/issue/${issueKey}?fields=summary`; const creds = btoa(`${settings.jiraEmail}:${settings.jiraToken}`);
    try {
        const response = await fetch(apiUrl, { method: 'GET', headers: { 'Authorization': `Basic ${creds}`, 'Accept': 'application/json' }, signal: AbortSignal.timeout(JIRA_SUMMARY_FETCH_TIMEOUT) });
        let data; try { data = await response.json(); } catch (e) { if (!response.ok) throw new Error(`HTTP ${response.status} (Yanıt parse edilemedi)`); data = {}; }
        if (!response.ok) { let errorMsg; if (response.status === 401) errorMsg = "Yetki hatası (401)."; else if (response.status === 403) errorMsg = "Erişim reddi (403)."; else if (response.status === 404) errorMsg = `Issue ${issueKey} bulunamadı.`; else errorMsg = data?.errorMessages?.join(', ') || data?.message || `HTTP ${response.status}`; console.error(`BG (fetchJiraIssueSummary) API Error: ${errorMsg}`, data); return { key: issueKey, summary: `[API Hatası: ${errorMsg}]`, error: true }; }
        const summary = data?.fields?.summary || "[Özet Yok]"; return { key: issueKey, summary: summary, error: false };
    } catch (e) { console.error(`BG (fetchJiraIssueSummary) Fetch Error ${issueKey}:`, e); if (e.name === 'AbortError') return { key: issueKey, summary: `[Zaman Aşımı]`, error: true }; return { key: issueKey, summary: `[Ağ Hatası: ${e.message}]`, error: true }; }
}

// Çalışan fetchJiraIssues fonksiyonu (Değişiklik yok, search bunu kullanacak)
async function fetchJiraIssues(settings, jql, maxResults = 15) {
    console.log("BG (fetchJiraIssues): Issue'lar alınıyor");
    const baseUrl = settings.jiraUrl.replace(/\/$/, ""); if (!baseUrl || !baseUrl.startsWith('http')) return { success: false, error: `Geçersiz Jira URL: ${baseUrl}` };
    const apiUrl = `${baseUrl}/rest/api/3/search`; const creds = btoa(`${settings.jiraEmail}:${settings.jiraToken}`);
    const requestBody = { jql: jql, maxResults: maxResults, fields: ["summary", "key"] };
    console.log(`BG (fetchJiraIssues): POST to ${apiUrl} with JQL: ${jql}`);
    try {
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Authorization': `Basic ${creds}`, 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(JIRA_SEARCH_TIMEOUT) }); // Using search timeout
        let data; try { const txt = await response.text(); data = JSON.parse(txt); } catch (e) { if (!response.ok) throw new Error(`HTTP ${response.status} (Yanıt parse edilemedi)`); data = {}; }
        if (!response.ok) { let errorMessage; if (response.status === 401) errorMessage = "Yetki hatası (401)."; else if (response.status === 403) errorMessage = "Erişim reddi (403)."; else if (response.status === 400) errorMessage = `JQL Hatası: ${data?.errorMessages?.join(', ') || "Geçersiz sorgu"}`; else errorMessage = data?.errorMessages?.join(', ') || data?.message || `HTTP ${response.status}`; console.error("BG (fetchJiraIssues) API Error:", errorMessage, data); return { success: false, error: errorMessage }; }
        if (!data?.issues || !Array.isArray(data.issues)) { console.warn("BG (fetchJiraIssues): Beklenmedik yanıt yapısı:", data); return { success: false, error: "Beklenmedik Jira yanıt yapısı." }; }
        console.log(`BG (fetchJiraIssues): Başarılı! ${data.issues.length} issue bulundu.`);
        const issues = data.issues.map(issue => ({ key: issue.key, summary: issue.fields?.summary || "[Özet Yok]" }));
        return { success: true, data: issues };
    } catch (error) { console.error("BG (fetchJiraIssues): Fetch hatası:", error); const errorMessage = error.name === 'AbortError' ? `İstek zaman aşımına uğradı (${JIRA_SEARCH_TIMEOUT/1000}s)` : `Ağ Hatası: ${error.message}`; return { success: false, error: errorMessage }; }
}


async function scheduleEndOfDayReminder(enabled) {
    console.log(`BG: Schedule reminder. Enabled: ${enabled}`);
    try {
        await chrome.alarms.clear(NOTIFICATION_ALARM_NAME); console.log(`BG: Alarm temizlendi "${NOTIFICATION_ALARM_NAME}".`);
        if (!enabled) { console.log("BG: Hatırlatıcı kapalı."); return; }
        const reminderTime = new Date(); reminderTime.setHours(18, 30, 0, 0);
        const now = new Date(); if (reminderTime < now) { reminderTime.setDate(reminderTime.getDate() + 1); console.log("BG: Yarın için ayarlandı."); }
        chrome.alarms.create(NOTIFICATION_ALARM_NAME, { when: reminderTime.getTime(), periodInMinutes: 1440 });
        console.log(`BG: Hatırlatıcı ayarlandı: ${reminderTime.toLocaleString()}.`);
    } catch (e) { console.error("BG: Hatırlatıcı ayarlama hatası:", e); chrome.alarms.clear(NOTIFICATION_ALARM_NAME).catch(e => {}); }
}

chrome.alarms.onAlarm.addListener(async(alarm) => {
    if (alarm.name === NOTIFICATION_ALARM_NAME) {
        console.log("BG: Hatırlatıcı alarmı tetiklendi.");
        try {
            const settings = await getSettings(); if (!settings.reminderEnabled) { console.log("BG: Ayarlarda hatırlatıcı kapalı."); await chrome.alarms.clear(NOTIFICATION_ALARM_NAME); return; }
            const storage = await chrome.storage.local.get(['effortLogs']); const logs = storage.effortLogs || {}; const today = new Date(); const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
            if (!logs[todayStr] || !Array.isArray(logs[todayStr]) || logs[todayStr].length === 0) { console.log(`BG: ${todayStr} için log yok, bildirim gösteriliyor.`); chrome.notifications.create(`effortReminder_${Date.now()}`, { type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), title: "Efor Kaydı Hatırlatma", message: "Bugünkü eforlarınızı kaydetmeyi unuttunuz mu?", priority: 0 }); }
            else { console.log(`BG: ${todayStr} için log bulundu, bildirim atlanıyor.`); }
        } catch (e) { console.error("BG: Hatırlatıcı kontrol hatası:", e); }
    }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('effortReminder_')) {
        console.log(`BG: Hatırlatıcı bildirimi tıklandı (${notificationId}).`);
        chrome.runtime.sendMessage({ action: "openLogPage" }).catch(e => console.error("BG: openLogPage mesajı gönderilemedi:", e));
        chrome.notifications.clear(notificationId).catch(e => console.error("BG: Bildirim temizlenemedi:", e));
    }
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log(`BG: Eklenti kuruldu/güncellendi. Sebep: ${details.reason}.`);
    getSettings().then(settings => { scheduleEndOfDayReminder(settings.reminderEnabled); }).catch(e => { console.error("BG: onInstalled hatırlatıcı hatası:", e); scheduleEndOfDayReminder(false); });
});

chrome.runtime.onStartup.addListener(() => {
    console.log("BG: Tarayıcı başlatıldı. Hatırlatıcı ayarlanıyor.");
    getSettings().then(settings => { scheduleEndOfDayReminder(settings.reminderEnabled); }).catch(e => { console.error("BG: onStartup hatırlatıcı hatası:", e); scheduleEndOfDayReminder(false); });
});

console.log("Background script (inline search version) loaded.");
// --- END OF FILE EfforLogger/js/background.js ---