// --- START OF FILE EfforLogger/js/background.js ---
/**
 * EfforLogger/js/background.js
 *
 * Service worker for background tasks.
 * Handles:
 * - Opening the main log page.
 * - Potential future features:
 *   - Fetching Jira issue details.
 *   - Setting alarms for end-of-day notifications.
 *   - Checking system state for "silent mode".
 */

// --- Open Main Log Page ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "openLogPage") {
        chrome.tabs.create({ url: chrome.runtime.getURL("html/log.html") });
    }
});

// --- Placeholder for Jira Integration ---
async function fetchJiraIssueSummary(issueKey) {
    // TODO: Implement Jira Cloud API call
    // 1. Get Jira base URL and API token/credentials from chrome.storage.sync (Settings)
    // 2. Construct the API URL (e.g., /rest/api/3/issue/{issueKey}?fields=summary)
    // 3. Use fetch() with appropriate headers (Authorization: Basic/Bearer)
    // 4. Handle response and errors
    console.warn(`Jira API call for ${issueKey} not implemented.`);
    // Example response structure: return { key: issueKey, summary: "Fetched Summary Placeholder" };
    return null; // Return null if not implemented or error
}

// Listener for requests from content scripts or log page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getJiraSummary" && request.issueKey) {
        fetchJiraIssueSummary(request.issueKey)
            .then(summary => sendResponse({ success: true, data: summary }))
            .catch(error => {
                console.error("Error fetching Jira summary:", error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Indicates asynchronous response
    }
    // Add listener for fetching recent Jira issues for modal (if implemented)
    // if (request.action === "getRecentJiraIssues") { ... }
});


// --- Placeholder for Smart Notifications ---
const NOTIFICATION_ALARM_NAME = "effortLogReminder";

function scheduleEndOfDayReminder() {
    // TODO: Implement logic based on user settings
    // 1. Get notification preference and time from chrome.storage.sync
    // 2. Calculate the next notification time (e.g., today at 6 PM)
    // 3. Use chrome.alarms.create()
    console.warn("End-of-day notification scheduling not implemented.");
    // Example:
    // const reminderTime = new Date();
    // reminderTime.setHours(18, 0, 0, 0); // Example: 6 PM
    // if (reminderTime < new Date()) { // If 6 PM already passed today, schedule for tomorrow
    //  reminderTime.setDate(reminderTime.getDate() + 1);
    // }
    // chrome.alarms.create(NOTIFICATION_ALARM_NAME, { when: reminderTime.getTime() });
}

// Listener for the alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === NOTIFICATION_ALARM_NAME) {
        // TODO: Check if logs were entered for today
        // 1. Load logs using chrome.storage.local.get
        // 2. Check if today's date has entries
        // 3. If no entries, show a Chrome notification
        console.warn("End-of-day notification check/display not implemented.");
        // Example notification:
        // chrome.notifications.create({
        //     type: "basic",
        //     iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        //     title: "Efor Kaydı Hatırlatma",
        //     message: "Bugünkü eforlarınızı kaydetmeyi unuttunuz mu?"
        // });

        // Re-schedule for the next day
        scheduleEndOfDayReminder();
    }
});

// Schedule on startup (or when settings change)
// scheduleEndOfDayReminder();


// --- Placeholder for Silent Mode ---
function isSilentModeActive() {
    // TODO: Implement complex logic
    // 1. Get silent mode settings (e.g., time range, days) from storage
    // 2. Check current time against the settings
    // 3. Potentially check calendar events (requires Calendar API permissions)
    console.warn("Silent mode check not implemented.");
    return false;
}

// --- Initial Setup (Optional) ---
chrome.runtime.onInstalled.addListener(() => {
    console.log("EfforLogger background script installed.");
    // scheduleEndOfDayReminder(); // Schedule first reminder on install
});