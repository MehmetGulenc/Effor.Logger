// --- START OF FILE EfforLogger/js/popup.js ---
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

// --- DOM Elements ---
const logTextInput = document.getElementById('log-text-input-popup');
const timeOptionsContainer = document.querySelector('.time-options-container');
const saveButton = document.getElementById('save-button-popup');
const errorMessage = document.getElementById('error-message-popup');
const viewLogsLink = document.getElementById('view-logs-link-popup');
const datalistElement = document.getElementById('recent-logs-datalist');
const bodyElement = document.body; // For theme application

// --- Constants ---
const defaultTimeOptions = [0.25, 0.5, 1, 1.5, 2, 3, 4, 8]; // Default quick time options
const TIME_REGEX = /(\d+(\.\d{1,2})?)\s*s?a?a?t?$/i; // Matches "0.5", "1 sa", "2 saat" at the end
const MIN_LOG_TEXT_LENGTH = 3; // Minimum characters before parsing time

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadThemePreference(); // Load theme first
    populateTimeOptions();
    loadRecentLogs(); // Populate autosuggest datalist

    saveButton.addEventListener('click', handleSaveLog);
    viewLogsLink.addEventListener('click', openLogPage);

    // Autofocus on the text input
    logTextInput.focus();

    // Enter key listener on text input
    logTextInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission if wrapped in form
            handleSaveLog();
        }
    });

    // Natural Language Processing on input change/blur
    logTextInput.addEventListener('input', parseLogInput);
    logTextInput.addEventListener('blur', parseLogInput);

    // Enter key listener on radio buttons
    timeOptionsContainer.addEventListener('keydown', (event) => {
        if (event.target.type === 'radio' && event.key === 'Enter') {
            event.preventDefault();
            handleSaveLog();
        }
    });

    // Double click on labels to save
     timeOptionsContainer.addEventListener('dblclick', (event) => {
        if (event.target.tagName === 'LABEL') {
            const radioId = event.target.getAttribute('for');
            if(radioId) {
                const radio = document.getElementById(radioId);
                if(radio) {
                    radio.checked = true;
                    handleSaveLog();
                }
            }
        }
    });

});

// --- Theme Management ---
 function applyPopupTheme(theme) {
    const newTheme = theme || 'dark'; // Default to dark if undefined
    const isLight = newTheme === 'light';

    bodyElement.classList.remove('dark-theme', 'light-theme');
    bodyElement.classList.add(isLight ? 'light-theme' : 'dark-theme');

    // Dynamically switch CSS (Requires <link> tags in popup.html)
    const darkLink = document.getElementById('dark-theme-link');
    const lightLink = document.getElementById('light-theme-link');

    if (darkLink && lightLink) {
        darkLink.disabled = isLight;
        lightLink.disabled = !isLight;
    } else {
        console.warn("Theme CSS link tags not found in popup.html");
        // Fallback or alternative styling method might be needed
    }
}

async function loadThemePreference() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['preferredTheme'], (result) => {
            const savedTheme = result.preferredTheme;
            let themeToApply;

            if (!savedTheme) {
                const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                themeToApply = prefersDark ? 'dark' : 'light';
            } else {
                themeToApply = savedTheme;
            }
            applyPopupTheme(themeToApply);
            resolve();
        });
    });
}


// --- UI Population ---
function populateTimeOptions() {
    timeOptionsContainer.innerHTML = ''; // Clear existing
    defaultTimeOptions.forEach((time) => {
        const optionDiv = document.createElement('div');
        optionDiv.classList.add('time-option');

        const radioId = `popup-time-${time.toString().replace('.', '-')}`;
        const radioInput = document.createElement('input');
        radioInput.type = 'radio';
        radioInput.id = radioId;
        radioInput.name = 'duration-popup';
        radioInput.value = time;

        const label = document.createElement('label');
        label.setAttribute('for', radioId);
        label.textContent = `${time} sa`;
        label.title = `Süreyi ${time} saat olarak ayarla (Kaydetmek için çift tıkla)`; // Tooltip

        optionDiv.appendChild(radioInput);
        optionDiv.appendChild(label);
        timeOptionsContainer.appendChild(optionDiv);
    });
}

async function loadRecentLogs() {
    try {
        const result = await chrome.storage.local.get(['effortLogs']);
        const allLogs = result.effortLogs || {};
        const descriptionCounts = {};
        const today = new Date().toISOString().split('T')[0].substring(0, 7); // Current YYYY-MM

        // Count descriptions from recent logs (e.g., last 30 days or current month)
        Object.entries(allLogs).forEach(([date, logs]) => {
             if (date.substring(0, 7) === today || isWithinLastNDays(date, 30)) { // Check current month or last 30 days
                logs.forEach(log => {
                    let desc = log.text.trim();
                    // Exclude entries that might just be times from natural parsing
                    if (!/^\d+(\.\d{1,2})?$/.test(desc)) {
                        descriptionCounts[desc] = (descriptionCounts[desc] || 0) + 1;
                    }
                });
            }
        });

        // Sort by frequency and get top suggestions
        const sortedDescriptions = Object.entries(descriptionCounts)
            .sort(([, countA], [, countB]) => countB - countA)
            .map(([desc]) => desc)
            .slice(0, 5); // Get top 5

        // Populate datalist
        datalistElement.innerHTML = ''; // Clear existing
        sortedDescriptions.forEach(desc => {
            const option = document.createElement('option');
            option.value = desc;
            datalistElement.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading recent logs for autosuggest:', error);
    }
}

// Helper for date check
function isWithinLastNDays(dateString, days) {
    const date = new Date(dateString);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return date >= cutoff;
}


// --- Event Handlers & Logic ---
function parseLogInput() {
    const currentText = logTextInput.value.trim();

    // Only parse if text is reasonably long to avoid parsing just "1"
    if (currentText.length < MIN_LOG_TEXT_LENGTH) {
        return;
    }

    const match = currentText.match(TIME_REGEX);

    if (match && match[1]) {
        const time = parseFloat(match[1]);
        const textWithoutTime = currentText.substring(0, match.index).trim();

        // Check if the extracted time matches a radio button
        const matchingRadio = timeOptionsContainer.querySelector(`input[value="${time}"]`);
        if (matchingRadio) {
            // If time found and radio exists, update text and select radio
             if (logTextInput.value !== textWithoutTime) { // Prevent infinite loop if already parsed
                logTextInput.value = textWithoutTime; // Remove time from text input
            }
            if (!matchingRadio.checked) {
                 matchingRadio.checked = true; // Select the corresponding radio
            }
        }
        // If time found but no matching radio, maybe fill a hidden time input?
        // For now, we primarily use it to select existing radio options.
    }
}


async function handleSaveLog() {
    errorMessage.textContent = ''; // Clear previous error
    const text = logTextInput.value.trim();
    let time = null;

    // Get time from selected radio button
    const selectedRadio = timeOptionsContainer.querySelector('input[name="duration-popup"]:checked');
    if (selectedRadio) {
        time = parseFloat(selectedRadio.value);
    } else {
        // Attempt to parse time from text *again* if no radio selected
         const match = text.match(TIME_REGEX);
         if(match && match[1]) {
             time = parseFloat(match[1]);
             // Keep the original text as entered by the user if parsed here
         }
    }

    // Validation
    if (!text) {
        errorMessage.textContent = 'Lütfen bir açıklama girin.';
        logTextInput.focus();
        return;
    }
    if (time === null || isNaN(time) || time <= 0) {
        errorMessage.textContent = 'Lütfen geçerli bir süre seçin veya girin (örn: Proje A 1.5).';
        // Maybe focus first radio?
        const firstRadio = timeOptionsContainer.querySelector('input[type="radio"]');
        if (firstRadio) firstRadio.focus();
        return;
    }

    // Prepare log entry (remove time from text if it was parsed and radio selected)
     let logTextToSave = text;
     if (selectedRadio) { // If radio was selected, ensure time suffix is removed from text
         const match = text.match(TIME_REGEX);
         if (match) {
             logTextToSave = text.substring(0, match.index).trim();
         }
     }


    const logEntry = {
        text: logTextToSave,
        time: time
    };
    const todayDate = new Date().toISOString().split('T')[0];

    // Save to storage
    try {
        const result = await chrome.storage.local.get(['effortLogs']);
        const logs = result.effortLogs || {};
        if (!logs[todayDate]) {
            logs[todayDate] = [];
        }
        logs[todayDate].push(logEntry);
        await chrome.storage.local.set({ effortLogs: logs });

        // Provide feedback & close
        saveButton.textContent = 'Kaydedildi!';
        saveButton.style.backgroundColor = '#1a7f37'; // Darker green
        logTextInput.value = ''; // Clear input
        if (selectedRadio) selectedRadio.checked = false; // Deselect radio
        loadRecentLogs(); // Refresh datalist

        setTimeout(() => {
            saveButton.textContent = 'Kaydet';
            saveButton.style.backgroundColor = ''; // Reset color
             window.close(); // Close popup after success
        }, 800); // Shorter delay

    } catch (error) {
        console.error('Error saving log:', error);
        errorMessage.textContent = 'Kaydetme hatası: ' + error.message;
        saveButton.textContent = 'Kaydet'; // Reset button text on error
    }
}

function openLogPage(event) {
    event.preventDefault(); // Prevent default link behavior
    // Send message to background script to open the log page
    chrome.runtime.sendMessage({ action: "openLogPage" });
    window.close(); // Close the popup after sending the message
}