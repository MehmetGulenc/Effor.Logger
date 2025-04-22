/**
 * EfforLogger/js/popup.js
 *
 * Handles interactions within the extension's popup (popup.html).
 * - Saves a quick log entry for today.
 * - Provides link to the main log page.
 * - Implements autosuggest and quick time selection.
 * - Handles theme loading.
 * - Basic natural language parsing for input.
 */
"use strict";

// --- DOM Elements ---
// Use const for elements expected to always exist
const logTextInput = document.getElementById('log-text-input-popup');
const timeOptionsContainer = document.querySelector('.time-options-container'); // Use querySelector for class
const saveButton = document.getElementById('save-button-popup');
const errorMessage = document.getElementById('error-message-popup');
const viewLogsLink = document.getElementById('view-logs-link-popup');
const datalistElement = document.getElementById('recent-logs-datalist');
const bodyElement = document.body;

// --- Constants ---
const defaultTimeOptions = [0.25, 0.5, 1, 1.5, 2, 3, 4, 8];
// Regex to find time at the end of the string, allowing optional 's', 'sa', 'saat'
const TIME_REGEX = /(\d+(\.\d+)?)\s*(s?a?a?t?)?$/i;
const MIN_LOG_TEXT_LENGTH = 1; // Allow parsing time from short inputs like "1"
const SETTINGS_STORAGE_KEY = 'effortLogger_Settings_v1';

// --- State ---
let currentPopupTheme = null; // Initialize theme state

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Popup DOM Loaded. Initializing..."); // Diagnostic

    // Verify core elements exist
    if (!logTextInput || !timeOptionsContainer || !saveButton || !errorMessage || !viewLogsLink || !datalistElement) {
        console.error("Popup Error: One or more essential DOM elements not found!");
        return; // Stop initialization if critical elements are missing
    }

    await loadAndApplyPopupTheme(); // Load theme first
    populateTimeOptions(); // Populate time options *after* ensuring container exists
    loadRecentLogs();

    // Attach Event Listeners
    saveButton.addEventListener('click', handleSaveLog);
    viewLogsLink.addEventListener('click', openLogPage);
    logTextInput.focus();
    logTextInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveLog(); } });
    logTextInput.addEventListener('input', parseLogInput);
    logTextInput.addEventListener('blur', parseLogInput);
    timeOptionsContainer.addEventListener('keydown', (e) => { if (e.target.type === 'radio' && e.key === 'Enter') { e.preventDefault(); handleSaveLog(); } });
    timeOptionsContainer.addEventListener('dblclick', (e) => { if (e.target.tagName === 'LABEL') { const radioId = e.target.getAttribute('for'); if (radioId) { const radio = document.getElementById(radioId); if (radio) { radio.checked = true; handleSaveLog(); } } } });

    // Listen for theme changes from storage
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[SETTINGS_STORAGE_KEY]) {
            const newSettings = changes[SETTINGS_STORAGE_KEY].newValue;
            // Apply theme only if it changed
            if (newSettings?.preferredTheme !== currentPopupTheme) {
                applyPopupTheme(newSettings?.preferredTheme);
            }
        }
    });

    console.log("Popup Initialization Complete."); // Diagnostic
});

// --- Theme Management ---
function applyPopupTheme(theme) {
    const newTheme = theme || 'dark'; // Default to dark if theme is null/undefined
    // Only apply if the theme is actually changing or not yet set
    if (newTheme === currentPopupTheme && bodyElement.classList.contains(`${newTheme}-theme`)) {
        return;
    }

    console.log("Popup: Applying theme -", newTheme); // Diagnostic
    currentPopupTheme = newTheme; // Update state
    const isLight = newTheme === 'light';

    bodyElement.classList.remove('dark-theme', 'light-theme');
    bodyElement.classList.add(isLight ? 'light-theme' : 'dark-theme');

    const darkLink = document.getElementById('dark-theme-link');
    const lightLink = document.getElementById('light-theme-link');

    if (darkLink && lightLink) {
        darkLink.disabled = isLight;
        lightLink.disabled = !isLight;
    } else {
        console.warn("Popup Warning: Theme CSS link tags not found in popup.html.");
    }
}

async function loadAndApplyPopupTheme() {
    console.log("Popup: Loading theme preference..."); // Diagnostic
    return new Promise((resolve) => {
        chrome.storage.sync.get(SETTINGS_STORAGE_KEY, (result) => {
            const settings = result[SETTINGS_STORAGE_KEY] || {};
            const savedTheme = settings.preferredTheme; // Get from combined settings object
            let themeToApply;
            if (savedTheme !== undefined && savedTheme !== null) {
                themeToApply = savedTheme;
                console.log("Popup: Found saved theme preference:", themeToApply); // Diagnostic
            } else {
                const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
                themeToApply = prefersDark ? 'dark' : 'light';
                console.log("Popup: No saved theme, detecting system preference:", themeToApply); // Diagnostic
            }
            applyPopupTheme(themeToApply);
            resolve();
        });
    });
}

// --- UI Population ---
function populateTimeOptions() {
    console.log("Popup: Populating time options..."); // Diagnostic
    if (!timeOptionsContainer) {
        console.error("Popup Error: timeOptionsContainer is null in populateTimeOptions!");
        return;
    }
    timeOptionsContainer.innerHTML = ''; // Clear existing options first
    let optionsAdded = 0;
    defaultTimeOptions.forEach((time) => {
        const optionDiv = document.createElement('div'); optionDiv.classList.add('time-option');
        const radioId = `popup-time-${time.toString().replace('.','-')}`;
        const radioInput = document.createElement('input'); radioInput.type = 'radio'; radioInput.id = radioId; radioInput.name = 'duration-popup'; radioInput.value = time;
        const label = document.createElement('label'); label.setAttribute('for', radioId); label.textContent = `${time} sa`; label.title = `Süre ${time} sa (Çift tık=Kaydet)`;
        optionDiv.appendChild(radioInput); optionDiv.appendChild(label); timeOptionsContainer.appendChild(optionDiv);
        optionsAdded++;
    });
    console.log(`Popup: Added ${optionsAdded} time options.`); // Diagnostic
    if (optionsAdded === 0) {
        console.warn("Popup Warning: No time options were added. Check defaultTimeOptions array.");
    }
    // **Crucial:** After adding elements, check if the container is actually visible in the DOM layout.
    // Use Developer Tools > Elements tab, find the container, and check its computed styles (especially display, height, opacity).
    const computedStyle = window.getComputedStyle(timeOptionsContainer);
     if (computedStyle.display === 'none' || computedStyle.height === '0px' || computedStyle.opacity === '0') {
         console.warn("Popup Warning: timeOptionsContainer is likely hidden by CSS!");
     }
}

async function loadRecentLogs() { /* (No functional change, kept previous logic) */
    try { const result=await chrome.storage.local.get(['effortLogs']); const allLogs=result.effortLogs||{}; const descCounts={}; const now=new Date(); const todayYM=now.toISOString().substring(0,7); const thirtyDaysAgo=new Date(now); thirtyDaysAgo.setDate(now.getDate()-30); Object.entries(allLogs).forEach(([date,logs])=>{const logDate=new Date(date); if(date.substring(0,7)===todayYM||logDate>=thirtyDaysAgo){logs.forEach(log=>{let desc=log.text.trim();if(desc&&!/^\d+(\.\d+)?$/.test(desc)){desc=desc.replace(TIME_REGEX,'').trim();if(desc){descCounts[desc]=(descCounts[desc]||0)+1;}}});}}); const sorted=Object.entries(descCounts).sort(([,a],[,b])=>b-a).map(([d])=>d).slice(0,10); datalistElement.innerHTML=''; sorted.forEach(d=>{const o=document.createElement('option'); o.value=d; datalistElement.appendChild(o);}); } catch(e){console.error('Autosuggest error:',e);}
 }
function isWithinLastNDays(dateStr, days) { /* (No functional change) */ const d=new Date(dateStr); const now=new Date(); const c=new Date(now); c.setDate(now.getDate()-days); const dS=new Date(dateStr); dS.setHours(0,0,0,0); const cS=new Date(c); cS.setHours(0,0,0,0); return dS>=cS; }

// --- Event Handlers & Logic ---
function parseLogInput() { /* (No functional change) */
    const txt=logTextInput.value.trim(); const match=txt.match(TIME_REGEX); if(match?.[1]){const time=parseFloat(match[1]); const radio=timeOptionsContainer.querySelector(`input[value="${time}"]`); if(radio){if(!radio.checked){radio.checked=true; const txtNoTime=txt.substring(0,match.index).trim(); if(logTextInput.value.trim()!==txtNoTime){logTextInput.value=txtNoTime; logTextInput.setSelectionRange(logTextInput.value.length,logTextInput.value.length);}}}else{const sel=timeOptionsContainer.querySelector('input:checked'); if(sel&&parseFloat(sel.value)!==time)sel.checked=false;}}else{const sel=timeOptionsContainer.querySelector('input:checked'); if(sel)sel.checked=false;}
}
async function handleSaveLog() { /* (No functional change) */
    errorMessage.textContent=''; const text=logTextInput.value.trim(); let time=null; const sel=timeOptionsContainer.querySelector('input:checked'); if(sel)time=parseFloat(sel.value); else{const match=text.match(TIME_REGEX); if(match?.[1])time=parseFloat(match[1]);} if(!text){errorMessage.textContent='Açıklama gerekli.';logTextInput.focus();return;} if(time===null||isNaN(time)||time<=0){errorMessage.textContent='Geçerli süre gerekli.';timeOptionsContainer.querySelector('input')?.focus();logTextInput.focus();return;} let logTxt=text; const txtMatch=text.match(TIME_REGEX); if(sel||(time!==null&&time>0&&txtMatch?.[1])){const origTxt=logTextInput.value.trim(); const matchRm=origTxt.match(TIME_REGEX); if(matchRm)logTxt=origTxt.substring(0,matchRm.index).trim(); else logTxt=origTxt;} if(!logTxt){errorMessage.textContent='Açıklama kısmı boş kalamaz.';logTextInput.focus();return;} const entry={text:logTxt,time:time,timestamp:Date.now()}; const today=getLocalISODateString(new Date()); try{const result=await chrome.storage.local.get(['effortLogs']); const logs=result.effortLogs||{}; if(!logs[today])logs[today]=[]; logs[today].push(entry); await chrome.storage.local.set({effortLogs:logs}); saveButton.innerHTML='<i class="fa-solid fa-check"></i> Kaydedildi!'; saveButton.disabled=true; saveButton.style.opacity='0.8'; logTextInput.value=''; if(sel)sel.checked=false; loadRecentLogs(); setTimeout(()=>window.close(),600);}catch(e){console.error('Save error:',e); errorMessage.textContent='Log kaydedilemedi.'; saveButton.disabled=false; saveButton.style.opacity='1'; saveButton.innerHTML='<i class="fa-regular fa-floppy-disk"></i> Kaydet';}
}
function openLogPage(e) {
    e.preventDefault(); // Prevent default link behavior
    console.log("Popup: 'View Logs' link clicked. Sending message to background..."); // Diagnostic
    try {
        chrome.runtime.sendMessage({ action: "openLogPage" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Popup Error: Error sending message to background:", chrome.runtime.lastError.message);
                errorMessage.textContent = "Ana sayfa açılamadı. Arkaplan hatası.";
            } else {
                console.log("Popup: Message sent to background. Closing popup."); // Diagnostic
                window.close(); // Close the popup after successfully sending the message
            }
        });
    } catch (error) {
        console.error("Popup Error: Failed to send message:", error);
        errorMessage.textContent = "Ana sayfa açılamadı. Mesaj gönderilemedi.";
    }
}
function getLocalISODateString(date) { /* (No functional change) */ const y=date.getFullYear(); const m=(date.getMonth()+1).toString().padStart(2,'0'); const d=date.getDate().toString().padStart(2,'0'); return `${y}-${m}-${d}`; }