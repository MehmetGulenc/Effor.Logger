"use strict";
$(document).ready(function () {
    // --- Configuration & Constants ---
    const SETTINGS_STORAGE_KEY = "effortLogger_Settings_v1";
    const LOGS_STORAGE_KEY = "effortLogs";
    const EMOJI_REGEX = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u;
    const JIRA_REGEX = /([A-Z][A-Z0-9]+-\d+)/g;
    const JIRA_SEARCH_TRIGGER_REGEX = /([A-Z][A-Z0-9]+-?\d*$)/i;
    const TIME_REGEX = /(\d+(?:\.\d+)?)\s*(?:sa|h)/i; // Matches "X.Y h" or "X.Y sa"
    const JIRA_SEARCH_DEBOUNCE_MS = 350;
    const JIRA_SEARCH_MIN_LENGTH = 2;
    const defaultTimeOptions = [0.25, 0.5, 1, 1.5, 2, 3, 4, 8];
    const DAY_NAMES_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

    // --- State Variables ---
    let currentYear = new Date().getFullYear();
    let currentMonth = new Date().getMonth();
    let holidays = [];
    let allLogs = {}; // Holds all log entries { "YYYY-MM-DD": [ {text, time, timestamp}, ... ] }
    let draggedLogData = null; // { text, time, timestamp, originalDate, originalIndex }
    let draggedLogElement = null; // The DOM element being dragged
    let chartInstances = { heatmap: null, monthly: null }; // Chart.js/CalHeatmap instances
    let userSettings = { // Default settings
        preferredTheme: null, // null = system preference
        colorPalette: {}, // Custom CSS variable overrides
        jiraUrl: "",
        jiraEmail: "",
        jiraToken: "",
        aiModel: "",
        aiKey: "",
        showAIChat: false,
        reminderEnabled: false,
    };
    let isSilentMode = false; // Flag to suppress toasts (not currently used but can be)
    let dropTargetIndex = -1; // Index where a dragged item will be dropped within a day list
    let jiraSearchDebounceTimer = null; // Timer for debouncing Jira API calls

    // --- jQuery Element Selectors (Cached) ---
    const calendarView = $("#calendar-view");
    const logEntryView = $("#log-entry-view"); // Placeholder, functionality moved to modal
    const summaryView = $("#summary-view");
    const settingsView = $("#settings-view");
    const logInputOverlay = $("#log-input-overlay");
    const logInputBox = $(".log-input-box"); // Container for the modal content
    const logModalTitle = $("#log-modal-title");
    const logTextInput = $("#log-text-input");
    const logTimeInput = $("#log-time-input");
    const logTargetDateInput = $("#log-target-date"); // Hidden input for date
    const editingLogIndexInput = $("#editing-log-index"); // Hidden input for index
    const saveLogButton = $("#save-log-button");
    const cancelLogButton = $("#cancel-log-button");
    const deleteLogButton = $("#delete-log-button");
    const modalErrorMessage = $("#edit-error-message");
    const toastNotification = $("#toast-notification");
    const themeToggleButton = $("#theme-toggle-button");
    const bodyElement = $("body");
    const modalTimeOptionsContainer = $("#log-input-overlay .time-options-container");
    const summaryContainer = $("#summary-view"); // Container for summary charts/info
    const btnCalendar = $("#btn-calendar");
    const btnLogEntry = $("#btn-log-entry"); // Sidebar button, now opens modal for today
    const btnSummary = $("#btn-summary");
    const btnSettings = $("#btn-settings");
    const btnAIChat = $("#btn-ai-chat");
    const aiChatWindow = $("#ai-chat-window");
    const aiChatMessages = $("#ai-chat-messages");
    const aiChatInput = $("#ai-chat-input-field");
    const aiChatSendButton = $("#ai-chat-send-button");
    const aiChatCloseButton = $("#ai-chat-close-button");
    const jiraSearchResultsContainer = $("#jira-search-results-container");

    // --- Initialization ---
    async function initializeApp() {
        console.log("EfforLogger: Initializing...");
        await loadAndApplySettings();
        holidays = await getHolidays();
        await loadLogs();
        switchView("calendar-view"); // Start on calendar view
        await renderCurrentCalendarView(); // Initial render
        initializeSidebarListeners();
        initializeModalListeners();
        initializeKeyboardShortcuts();
        initializeThemeToggle();
        initializeSettingsListeners();
        initializeAIChatListeners();
        // logEntryView.on('click', () => openLogModal(getLocalISODateString(new Date()))); // Removed direct click on view
        createModalTimeOptions(); // Populate time buttons in modal
        console.log("EfforLogger: Initialization complete.");
        btnAIChat.toggle(userSettings.showAIChat && !!userSettings.aiKey && !!userSettings.aiModel);
        if (aiChatWindow.is(':visible')) aiChatWindow.hide(); // Ensure AI chat is hidden initially
        scrollToToday(); // Scroll to today on initial load
    }

    // --- Settings Management ---
    async function loadAndApplySettings() {
        console.log("EfforLogger: Loading settings...");
        try {
            const result = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
            if (result?.[SETTINGS_STORAGE_KEY]) {
                const loaded = result[SETTINGS_STORAGE_KEY];
                // Merge loaded settings with defaults, ensuring nested objects like colorPalette are merged too
                userSettings = {
                    ...userSettings, // Start with defaults
                    ...loaded, // Overwrite with loaded values
                    colorPalette: { ...(userSettings.colorPalette || {}), ...(loaded.colorPalette || {}) }, // Deep merge palette
                    // Explicitly handle boolean defaults if missing in loaded data
                    showAIChat: loaded.showAIChat ?? userSettings.showAIChat,
                    reminderEnabled: loaded.reminderEnabled ?? userSettings.reminderEnabled,
                };
                console.log("EfforLogger: Loaded settings:", userSettings);
            } else {
                console.log("EfforLogger: No settings found, using defaults.");
            }
            await applyThemePreference(); // Apply theme based on loaded or system preference
            applyCustomColors(userSettings.colorPalette); // Apply custom colors
            btnAIChat.toggle(userSettings.showAIChat && !!userSettings.aiKey && !!userSettings.aiModel); // Update AI chat button visibility
        } catch (e) {
            console.error("Error loading settings:", e);
            showToast("Ayarlar yüklenemedi.", 3000);
            await applyThemePreference(); // Attempt to apply theme even on error
        }
        console.log("EfforLogger: Settings loaded & applied.");
    }

    async function saveSettings() {
        console.log("EfforLogger: Saving settings:", userSettings);
        $("#settings-save-status").text("Kaydediliyor...").css("color", "var(--text-secondary-color)").fadeIn();
        try {
            await chrome.storage.sync.set({ [SETTINGS_STORAGE_KEY]: userSettings });
            showToast("Ayarlar kaydedildi.", 1500);
            $("#settings-save-status").text("Kaydedildi!").css("color", "var(--button-copy)").delay(1500).fadeOut();
            // Send message to background script if reminder settings changed
            chrome.runtime.sendMessage({ action: "updateReminderSchedule", enabled: userSettings.reminderEnabled }).catch((e) => console.error("Send msg err:", e));
        } catch (e) {
            console.error("Error saving settings:", e);
            showToast("Ayarlar kaydedilemedi!", 3000);
            $("#settings-save-status").text("Kaydetme hatası!").css("color", "var(--error-color)").delay(3000).fadeOut();
        }
    }

    // --- Theme & Appearance ---
    function applyTheme(theme, isInitialLoad = false) {
        const normalizedTheme = theme || "dark"; // Default to dark if no theme specified
        const isLightTheme = normalizedTheme === "light";

        if (!isInitialLoad) console.log(`Applying theme: ${normalizedTheme}`);

        // Update body class
        bodyElement.removeClass("dark-theme light-theme").addClass(isLightTheme ? "light-theme" : "dark-theme");

        // Enable/disable theme stylesheets (assuming they are linked in HTML)
        const darkLink = $('link[href*="dark-theme.css"]');
        const lightLink = $('link[href*="light-theme.css"]');
        if (darkLink.length && lightLink.length) {
            darkLink.prop("disabled", isLightTheme);
            lightLink.prop("disabled", !isLightTheme);
        } else {
            console.warn("Theme CSS links not found. Ensure dark-theme.css and light-theme.css are linked.");
        }

        // Update theme toggle button icon and title
        themeToggleButton.html(isLightTheme ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>')
                         .attr("title", isLightTheme ? "Koyu Tema" : "Açık Tema");

        // Update chart themes if summary view is active
        if ($("#summary-view").hasClass("active")) {
            updateChartThemes(normalizedTheme);
        }

        // Re-apply custom colors as they might depend on the base theme
        applyCustomColors(userSettings.colorPalette);
    }

    async function applyThemePreference() {
        let themeToApply = userSettings.preferredTheme;
        // If no user preference, detect system preference
        if (!themeToApply) {
            const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
            themeToApply = prefersDark ? "dark" : "light";
        }
        applyTheme(themeToApply, true); // Apply the determined theme (initial load)
    }

    function initializeThemeToggle() {
        // Toggle button click listener
        themeToggleButton.on("click", () => {
            const currentTheme = bodyElement.hasClass("light-theme") ? "light" : "dark";
            const nextTheme = currentTheme === "light" ? "dark" : "light";
            userSettings.preferredTheme = nextTheme; // Save user preference
            applyTheme(nextTheme); // Apply the new theme
            saveSettings(); // Persist the setting
        });

        // Listen for system theme changes (if user hasn't set a preference)
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
            if (userSettings.preferredTheme === null) { // Only react if no user preference is set
                console.log("System theme changed:", e.matches ? "dark" : "light");
                applyTheme(e.matches ? "dark" : "light");
            }
        });

        // Listen for changes in Chrome storage (e.g., from options page or sync)
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "sync" && changes[SETTINGS_STORAGE_KEY]) {
                const newSettings = changes[SETTINGS_STORAGE_KEY].newValue;
                if (newSettings) {
                    let themeChanged = false;
                    let colorsChanged = false;
                    let aiSettingsChanged = false;
                    let reminderChanged = false;
                    let jiraChanged = false;

                    // Check for theme change
                    if (newSettings.preferredTheme !== userSettings.preferredTheme) {
                        userSettings.preferredTheme = newSettings.preferredTheme;
                        themeChanged = true;
                    }

                    // Check for color palette change
                    if (JSON.stringify(newSettings.colorPalette) !== JSON.stringify(userSettings.colorPalette)) {
                        userSettings.colorPalette = newSettings.colorPalette || {};
                        colorsChanged = true;
                    }

                    // Check for Jira settings change
                    if (newSettings.jiraUrl !== userSettings.jiraUrl || newSettings.jiraEmail !== userSettings.jiraEmail || newSettings.jiraToken !== userSettings.jiraToken) {
                        userSettings.jiraUrl = newSettings.jiraUrl || "";
                        userSettings.jiraEmail = newSettings.jiraEmail || "";
                        userSettings.jiraToken = newSettings.jiraToken || "";
                        jiraChanged = true; // Though no immediate UI update needed here
                    }

                    // Check for AI settings change
                    if (newSettings.aiModel !== userSettings.aiModel || newSettings.aiKey !== userSettings.aiKey || newSettings.showAIChat !== userSettings.showAIChat) {
                         userSettings.aiModel = newSettings.aiModel || "";
                         userSettings.aiKey = newSettings.aiKey || "";
                         userSettings.showAIChat = newSettings.showAIChat ?? false;
                         aiSettingsChanged = true;
                    }

                    // Check for reminder change
                    if (newSettings.reminderEnabled !== userSettings.reminderEnabled) {
                         userSettings.reminderEnabled = newSettings.reminderEnabled ?? false;
                         reminderChanged = true; // No immediate UI update needed here
                    }

                    // Apply UI updates based on changes
                    if (themeChanged) applyThemePreference();
                    if (colorsChanged) applyCustomColors(userSettings.colorPalette);
                    if (aiSettingsChanged) {
                        btnAIChat.toggle(userSettings.showAIChat && !!userSettings.aiKey && !!userSettings.aiModel);
                        if (!userSettings.showAIChat) closeAIChatWindow();
                    }
                }
            }
        });
    }

    function applyCustomColors(palette) {
        const rootStyle = document.documentElement.style;
        const colorVariables = [
            "--weekend-bg-color", "--saturday-bg-color", "--holiday-bg-color",
            "--primary-color", "--text-color", "--text-secondary-color",
            "--button-copy", "--error-color"
        ];

        // Remove existing custom properties first to handle removals
        colorVariables.forEach(variable => rootStyle.removeProperty(variable));

        // Apply new custom properties from the palette
        colorVariables.forEach(variable => {
            if (palette && palette[variable] && palette[variable] !== "") {
                rootStyle.setProperty(variable, palette[variable]);
            }
        });

        // Re-render or update parts of the UI sensitive to color changes if needed
        if ($("#summary-view").hasClass("active")) {
            updateChartThemes(bodyElement.hasClass("light-theme") ? "light" : "dark");
        }
        // Note: Calendar view re-rendering on color change might be too disruptive.
        // Colors are applied via CSS vars, so existing elements should update automatically.
    }

    function resetColorsToDefaults() {
        console.log("Resetting custom colors to defaults...");
        const keysToReset = [
            "--weekend-bg-color", "--saturday-bg-color", "--holiday-bg-color", "--primary-color"
            // Add other resettable color vars if needed
        ];

        try {
            keysToReset.forEach(key => {
                console.log(`Resetting color ${key}`);
                document.documentElement.style.removeProperty(key); // Remove from inline style
                // Ensure colorPalette exists before deleting
                if (userSettings.colorPalette) {
                     delete userSettings.colorPalette[key]; // Remove from settings object
                }
                // Reset corresponding input field in settings view
                $(`input[data-css-var="${key}"]`).val("");
            });

            console.log("Colors reset in UI and settings object. Saving...");
            saveSettings(); // Save the settings with colors removed
            console.log("Settings saved. Applying updated custom colors...");
            applyCustomColors(userSettings.colorPalette); // Re-apply (which effectively clears them)
            console.log("Custom colors applied. Showing toast...");
            showToast("Renkler sıfırlandı.", 1500);
        } catch(error) {
             console.error("ERROR in resetColorsToDefaults:", error);
             showToast("Renkleri sıfırlarken hata oluştu!", 3000);
        }
    }

    // --- Log Data Management (CRUD) ---
    async function loadLogs() {
        try {
            const result = await chrome.storage.local.get([LOGS_STORAGE_KEY]);
            // Validate loaded data structure
            if (result?.[LOGS_STORAGE_KEY] && typeof result[LOGS_STORAGE_KEY] === "object" && !Array.isArray(result[LOGS_STORAGE_KEY])) {
                allLogs = result[LOGS_STORAGE_KEY];
            } else {
                if (result?.[LOGS_STORAGE_KEY]) { // Check if it exists but is invalid
                    console.warn("Invalid log data structure found in storage. Resetting.", result[LOGS_STORAGE_KEY]);
                }
                allLogs = {}; // Initialize as empty object if not found or invalid
            }
            console.log(`Loaded ${Object.keys(allLogs).length} days of logs.`);
            return allLogs;
        } catch (e) {
            console.error("Error loading logs:", e);
            showToast("Loglar yüklenemedi.");
            allLogs = {}; // Reset on error
            return {};
        }
    }

    async function saveLogs(logsToSave) {
        try {
            // Basic validation before saving
            if (typeof logsToSave !== 'object' || logsToSave === null || Array.isArray(logsToSave)) {
                throw new Error("Attempted to save invalid log data structure.");
            }
            await chrome.storage.local.set({ [LOGS_STORAGE_KEY]: logsToSave });
            allLogs = logsToSave; // Update in-memory copy
            console.log(`Saved ${Object.keys(allLogs).length} days of logs.`);
        } catch (e) {
            console.error("Error saving logs:", e);
            showToast("Loglar kaydedilemedi.");
            // Potentially reload logs from storage to revert if save failed?
            // await loadLogs();
        }
    }

    async function getLogsForDate(dateString) {
        // Return a deep copy to prevent accidental modification of allLogs
        return JSON.parse(JSON.stringify(allLogs[dateString] || []));
    }

    // --- Log Data Management (CRUD) --- Updated Functions Start ---

    async function addLogEntry(dateString, entry) {
        if (!allLogs[dateString]) {
            allLogs[dateString] = []; // Initialize array if day doesn't exist
        }
        // Ensure entry has a timestamp for ordering (use current time if missing)
        if (!entry.timestamp) {
            entry.timestamp = Date.now();
        }
        allLogs[dateString].push(entry);
        await saveLogs(allLogs); // Persist changes

        // --- Scroll Position Handling ---
        const targetDate = dateString; // Date to scroll to
        await renderCurrentCalendarView();
        // Use setTimeout to slightly delay scroll restoration
        setTimeout(() => {
             console.log(`Scrolling to day after addLogEntry: ${targetDate}`);
             const targetElement = $(`.day-item[data-date="${targetDate}"]`)[0];
             if (targetElement) {
                 // Scroll the target day element into view, aligning it to the nearest edge
                 targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
             }
        }, 0); // 0ms delay pushes execution after current rendering tasks
    }

    async function updateLogEntry(dateString, index, entry) {
        if (allLogs[dateString]?.[index]) {
            // Preserve original timestamp if it exists, otherwise set new one
            const originalTimestamp = allLogs[dateString][index].timestamp;
            allLogs[dateString][index] = { ...entry, timestamp: originalTimestamp || Date.now() };
            await saveLogs(allLogs); // Persist changes

            // --- Scroll Position Handling ---
            const targetDate = dateString; // Date to scroll to
            await renderCurrentCalendarView();
             // Use setTimeout to slightly delay scroll restoration
            setTimeout(() => {
                 console.log(`Scrolling to day after updateLogEntry: ${targetDate}`);
                 const targetElement = $(`.day-item[data-date="${targetDate}"]`)[0];
                 if (targetElement) {
                     // Scroll the target day element into view
                     targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                 }
            }, 0);
        } else {
            console.error("Log update error: Invalid date or index.", dateString, index);
            showToast("Log güncellenemedi.");
            // Consider reloading logs if state might be inconsistent
            // await loadLogs();
            // await renderCurrentCalendarView();
        }
    }

    async function deleteLogEntry(dateString, index) {
        if (allLogs[dateString]?.[index]) {
            allLogs[dateString].splice(index, 1); // Remove the entry
            // If the day becomes empty, remove the date key
            if (allLogs[dateString].length === 0) {
                delete allLogs[dateString];
            }
            await saveLogs(allLogs); // Persist changes

            // --- Scroll Position Handling ---
            const targetDate = dateString; // Date to scroll to
            await renderCurrentCalendarView();
             // Use setTimeout to slightly delay scroll restoration
            setTimeout(() => {
                 console.log(`Scrolling to day after deleteLogEntry: ${targetDate}`);
                 const targetElement = $(`.day-item[data-date="${targetDate}"]`)[0];
                 if (targetElement) {
                     // Scroll the target day element into view
                     targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                 }
            }, 0);
        } else {
            console.error("Log delete error: Invalid date or index.", dateString, index);
            showToast("Log silinemedi.");
            // Consider reloading logs if state might be inconsistent
            // await loadLogs();
            // await renderCurrentCalendarView();
        }
    }

    async function clearDayLogs(dateString) {
        if (allLogs[dateString]) {
            delete allLogs[dateString]; // Remove the entire day's logs
            await saveLogs(allLogs); // Persist changes

            // --- Scroll Position Handling ---
            const targetDate = dateString; // Date to scroll to
            await renderCurrentCalendarView();
             // Use setTimeout to slightly delay scroll restoration
            setTimeout(() => {
                 console.log(`Scrolling to day after clearDayLogs: ${targetDate}`);
                 const targetElement = $(`.day-item[data-date="${targetDate}"]`)[0];
                 if (targetElement) {
                     // Scroll the target day element into view
                     targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                 }
            }, 0);
            showToast(`${dateString} tarihindeki loglar silindi.`);
        } else {
            showToast("Bu tarihte silinecek log bulunmuyor.");
        }
    }

    // --- Log Data Management (CRUD) --- Updated Functions End ---


    // --- Holiday Data ---
    async function getHolidays() {
        // Attempts to fetch holidays.json, provides basic error handling.
        try {
            const url = chrome.runtime.getURL("holidays.json");
            const response = await fetch(url);
            if (!response.ok) {
                // Basic fallback/error logging
                 console.error(`Failed to fetch holidays.json: ${response.status} ${response.statusText}`);
                 throw new Error(`HTTP error ${response.status}`);
            }
            const holidayData = await response.json();
            // Optional: Add validation here to ensure data format is correct
            console.log(`Loaded ${holidayData.length} holidays.`);
            return holidayData;
        } catch (e) {
            console.error("Error loading or parsing holidays:", e);
            showToast("Tatil bilgileri yüklenemedi.");
            return []; // Return empty array on failure
        }
    }

    // --- View Switching & Navigation ---
    function switchView(targetViewId, targetDate = null) {
        console.log(`Switching view to: ${targetViewId}${targetDate ? ` (Target Date: ${targetDate})` : ''}`);

        // Hide AI chat unless specifically switching to it (though it's not a main 'view')
        if (targetViewId !== 'ai-chat-view') { // Assuming 'ai-chat-view' is not a real view ID
            closeAIChatWindow();
        }

        const previouslyActiveViewId = $('.view.active').attr('id');
        const isSwitchingToCalendar = targetViewId === 'calendar-view';
        const isSwitchingFromCalendar = previouslyActiveViewId === 'calendar-view';

        // Stop ongoing rendering/loading in the previous view if necessary (e.g., cancel fetches)

        // Deactivate current view and sidebar button
        $('.view.active').removeClass('active');
        $('.sidebar button.active').removeClass('active');

        // Activate new view and corresponding sidebar button
        $('#' + targetViewId).addClass('active');
        $(`#btn-${targetViewId.split('-')[1]}`).addClass('active'); // Assumes button ID format btn-viewName

        // Perform actions specific to the target view
        switch (targetViewId) {
            case 'calendar-view':
                // Render calendar, then handle scrolling
                renderCurrentCalendarView().then(() => {
                    if (targetDate) {
                        scrollToDate(targetDate); // Scroll to specific date if provided
                    } else if (!isSwitchingFromCalendar) {
                         // Only scroll to today if navigating *from another view*
                         // Avoids scrolling to top/today when already on calendar
                         scrollToToday();
                    }
                    // If switching *within* calendar (e.g. month change), scroll is handled by changeMonth
                });
                break;
            case 'summary-view':
                loadAndRenderSummary();
                break;
            case 'settings-view':
                initializeSettingsView(); // Populate settings fields
                break;
            case 'log-entry-view': // This view is now handled by the modal
                 // The sidebar button click handler now directly calls openLogModal
                 console.warn("Direct switch to 'log-entry-view' is deprecated. Use modal.");
                 // Fallback: open modal for today if somehow triggered
                 openLogModal(targetDate || getLocalISODateString(new Date()));
                 // Ensure calendar remains the 'active' view visually
                 $('#calendar-view').addClass('active');
                 $('#btn-calendar').addClass('active');
                 $('#log-entry-view').removeClass('active'); // Deactivate placeholder view
                 $('#btn-log-entry').removeClass('active'); // Deactivate placeholder button
                break;
        }
    }

    function initializeSidebarListeners() {
        btnCalendar.on("click", () => switchView("calendar-view"));
        btnLogEntry.on("click", () => {
            // Opens the log modal for today's date
            const todayDate = getLocalISODateString(new Date());
            // If already on calendar view, ensure today is visible before opening modal
            if ($("#calendar-view").hasClass("active")) {
                scrollToDate(todayDate); // Scroll today into view smoothly
            }
            openLogModal(todayDate); // Open modal for today
        });
        btnSummary.on("click", () => switchView("summary-view"));
        btnSettings.on("click", () => switchView("settings-view"));
        // AI chat button listener is initialized separately in initializeAIChatListeners
    }

    async function changeMonth(direction) {
        currentMonth += direction;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        } else if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }

        // Store scroll position *before* re-rendering
        const scrollPos = calendarView.scrollTop();

        await renderCurrentCalendarView(); // Re-render the new month

        // Restore scroll position *after* rendering, slightly delayed
        setTimeout(() => {
             console.log(`Restoring scroll after changeMonth: ${scrollPos}`);
             calendarView.scrollTop(scrollPos);
        }, 0);


        // Provide feedback to the user
        const monthName = new Date(currentYear, currentMonth).toLocaleString('tr-TR', { month: 'long' });
        showToast(`${monthName} ${currentYear}`, 1500);

    }


    // --- Calendar Rendering ---
    async function renderCurrentCalendarView() {
        // Show loading indicator
        calendarView.empty().append('<div class="loading-spinner"></div><p class="loading-text">Takvim yükleniyor...</p>');

        // Filter logs for the current month and year efficiently
        const logsForMonth = {};
        const monthPrefix = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-`;
        for (const date in allLogs) {
            if (date.startsWith(monthPrefix)) {
                logsForMonth[date] = allLogs[date];
            }
        }

        // Render the month structure
        const monthContainer = renderMonth(currentYear, currentMonth, logsForMonth);

        // Replace loading indicator with the rendered month
        // Use requestAnimationFrame to ensure the DOM is ready for interactions/scrolling
        return new Promise(resolve => {
             requestAnimationFrame(() => {
                 calendarView.empty().append(monthContainer);
                 initializeCalendarEventListeners(); // Attach listeners to new elements
                 initializeDragAndDrop(); // Initialize DnD for new elements
                 console.log(`Calendar rendered for ${currentYear}-${currentMonth + 1}`);
                 resolve(); // Resolve the promise after rendering and setup
             });
        });
    }


    function renderMonth(year, month, logsForMonth) {
        const monthContainer = $("<div>").addClass("month-container");
        const monthName = new Date(year, month).toLocaleString("tr-TR", { month: "long" });

        // Month Header (e.g., "Nisan 2025")
        monthContainer.append(`<h3 class="month-header">${monthName} ${year}</h3>`);

        const dayList = $("<ul>").addClass("day-list");
        const daysInMonth = getDaysInMonth(year, month);
        const today = new Date(); today.setHours(0, 0, 0, 0); // Normalize today's date

        // Render each day
        for (let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(year, month, day); currentDate.setHours(0, 0, 0, 0);
            const isToday = currentDate.getTime() === today.getTime();
            const dateString = getLocalISODateString(currentDate);
            const dayItem = renderDayItem(currentDate, logsForMonth, holidays, isToday, dateString);
            dayList.append(dayItem);
        }

        monthContainer.append(dayList);
        return monthContainer;
    }

    function renderDayItem(date, logsForMonth, holidays, isToday, dateString) {
        const dayOfMonth = date.getDate();
        const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
        const dayLogs = logsForMonth[dateString] || [];
        const totalTime = dayLogs.reduce((sum, log) => sum + parseFloat(log.time || 0), 0);
        const holidayInfo = holidays.find(h => h.date === dateString);

        const dayItem = $("<li>")
            .addClass("day-item")
            .attr({ "data-date": dateString, title: `${dateString} - Log ekle/düzenle` });

        // Add classes for styling
        if (isToday) dayItem.addClass("today");
        if (dayOfWeek === 0) dayItem.addClass("weekend sunday"); // Sunday
        if (dayOfWeek === 6) dayItem.addClass("weekend saturday"); // Saturday
        if (holidayInfo) dayItem.addClass("holiday");

        // --- Day Header ---
        const dayHeader = $("<div>").addClass("day-header");
        const dateInfo = $("<span>").addClass("date-info");
        dateInfo.append($("<span>").addClass("day-number").text(dayOfMonth))
                .append($("<span>").addClass("day-name").text(` ${getDayNameTR(dayOfWeek)}`)); // Turkish day name

        if (holidayInfo) {
            dateInfo.append($("<span>").addClass("holiday-name").text(` (${holidayInfo.name})`).attr("title", holidayInfo.name));
        }

        // --- Day Buttons ---
        const dayButtons = $("<div>").addClass("day-buttons");
        if (!holidayInfo) { // Only show add/clear/copy buttons on non-holidays
            dayButtons.append($("<button>").addClass("add-log-placeholder day-action-btn").attr("title", "Log ekle").html('<i class="fa-solid fa-plus"></i>'));
            if (dayLogs.length > 0) {
                dayButtons.append($("<button>").addClass("copy-to-next-day day-action-btn").attr("title", "Sonraki iş gününe kopyala").html('<i class="fa-regular fa-clone"></i>'));
                dayButtons.append($("<button>").addClass("clear-day-logs day-action-btn").attr("title", "Günün loglarını sil").html('<i class="fa-solid fa-eraser"></i>'));
                dayButtons.append($("<button>").addClass("copy-day-logs day-action-btn").attr("title", "Günü panoya kopyala").html('<i class="fa-regular fa-copy"></i>'));
            }
        } else {
             // Allow copying logs even on holidays if they exist
             if (dayLogs.length > 0) {
                 dayButtons.append($("<button>").addClass("copy-day-logs day-action-btn").attr("title", "Günü panoya kopyala").html('<i class="fa-regular fa-copy"></i>'));
             }
             dayItem.addClass("holiday-disabled"); // Visually indicate non-interactive holiday
        }


        dayHeader.append(dateInfo);
        // Display total time only if > 0
        if (totalTime > 0) {
            dayHeader.append($("<span>").addClass("day-total-time").text(`${formatTime(totalTime)} sa`));
        }
        dayHeader.append(dayButtons);

        // --- Log List ---
        const logList = $("<ul>").addClass("log-list");
        if (dayLogs.length > 0) {
            // Sort logs by timestamp for consistent order before rendering
            dayLogs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            dayLogs.forEach((log, index) => logList.append(renderLogItem(log, index, dateString, !!holidayInfo)));
        } else {
            // Placeholder for empty days
            const noLogsItem = $("<li>").addClass("no-logs");
            if (holidayInfo) {
                noLogsItem.text(`${holidayInfo.name}`).addClass("holiday-info"); // Show holiday name
            } else {
                noLogsItem.text("Log eklemek için tıklayın").attr("title", "Log ekle"); // Prompt to add logs
            }
            logList.append(noLogsItem);
        }

        dayItem.append(dayHeader).append(logList);
        return dayItem;
    }

    function renderLogItem(log, index, dateString, isHoliday) {
        const logItem = $("<li>")
            .addClass("log-item")
            .attr({
                "data-log-index": index,
                "data-date": dateString,
                draggable: !isHoliday, // Only draggable if not on a holiday
                title: `${log.text} (${formatTime(log.time)} sa) - Düzenle/Taşı`
            });

        if (isHoliday) {
            logItem.addClass("disabled-log").attr("draggable", false); // Style disabled logs
        }

        const textSpan = $("<span>").addClass("log-text");
        const timeSpan = $("<span>").addClass("log-time").text(formatTime(log.time));
        const logTextContent = log.text || "";

        // Handle Emoji at the start
        const emojiMatch = logTextContent.trim().match(EMOJI_REGEX);
        if (emojiMatch) {
            const emoji = emojiMatch[1];
            const restOfText = logTextContent.trim().substring(emoji.length).trim();
            textSpan.append($("<span>").addClass("log-emoji").text(emoji))
                    .append(document.createTextNode(" " + restOfText)); // Add space after emoji
        } else {
            textSpan.text(logTextContent); // Display text normally
        }

        // Handle Jira Key Linking (if configured)
        const jiraMatches = logTextContent.match(JIRA_REGEX);
        if (jiraMatches && userSettings.jiraUrl && userSettings.jiraToken) {
            const jiraIcon = $("<i>")
                .addClass("fa-brands fa-jira jira-icon")
                .attr("title", `Jira Detayları: ${jiraMatches.join(", ")}`);

            // Add click handler to fetch Jira summary (preventing log edit click)
            jiraIcon.on("click", (e) => {
                e.stopPropagation(); // Prevent triggering the log item click
                fetchAndShowJiraSummary(jiraMatches[0]); // Fetch summary for the first match
            });
            textSpan.append(jiraIcon); // Append icon next to text
            logItem.addClass("has-jira-key"); // Add class for potential styling
        }

        logItem.append(textSpan).append(timeSpan);
        return logItem;
    }

    // --- Calendar Event Listeners ---
    function initializeCalendarEventListeners() {
        calendarView.off(".logEvents"); // Remove previous listeners to prevent duplicates

        // Click on empty area of a day item (non-holiday) -> Open modal to add log
        calendarView.on("click.logEvents", ".day-item:not(.holiday-disabled)", function (e) {
            // Ensure click is not on a button, existing log, or holiday info text
            if (!$(e.target).closest(".day-buttons, .log-item, .holiday-info, .no-logs:not([title='Log ekle'])").length) {
                const date = $(this).data("date");
                openLogModal(date); // Open modal for adding a new log to this date
            }
        });

        // Click on an existing log item (non-disabled) -> Open modal to edit
        calendarView.on("click.logEvents", ".log-item:not(.disabled-log)", function (e) {
            e.stopPropagation(); // Prevent day item click
            const date = $(this).closest(".day-item").data("date");
            const index = $(this).data("log-index");
            openLogModal(date, index); // Open modal for editing this specific log
        });

        // Click on "Log eklemek için tıklayın" placeholder -> Open modal to add
        calendarView.on("click.logEvents", ".no-logs[title='Log ekle']", function (e) {
             e.stopPropagation(); // Prevent day item click
             const date = $(this).closest(".day-item").data("date");
             openLogModal(date);
        });


        // Click on placeholder "+" button -> Open modal to add
        calendarView.on("click.logEvents", ".add-log-placeholder", function (e) {
            e.stopPropagation(); // Prevent day item click
            const date = $(this).closest(".day-item").data("date");
            openLogModal(date);
        });

        // Click on "Copy Day Logs" button
        calendarView.on("click.logEvents", ".copy-day-logs", function (e) {
            e.stopPropagation();
            copyDayLogsToClipboard($(this).closest(".day-item").data("date"), $(this));
        });

        // Click on "Clear Day Logs" button
        calendarView.on("click.logEvents", ".clear-day-logs", function (e) {
            e.stopPropagation();
            const date = $(this).closest(".day-item").data("date");
            if (confirm(`'${date}' tarihindeki tüm logları silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`)) {
                clearDayLogs(date); // Calls the updated version
            }
        });

        // Click on "Copy to Next Day" button
        calendarView.on("click.logEvents", ".copy-to-next-day", async function (e) {
            e.stopPropagation();
            await handleCopyToNextDay($(this)); // Handle finding the next valid day and copying
        });
    }

    // --- Log Input Modal ---
    function createModalTimeOptions() {
        modalTimeOptionsContainer.empty(); // Clear existing options
        defaultTimeOptions.forEach(timeValue => {
            const optionDiv = $("<div>").addClass("time-option");
            const inputId = `modal-time-${timeValue.toString().replace(".", "-")}`; // Create unique ID
            const radioInput = $("<input>").attr({
                type: "radio",
                id: inputId,
                name: "duration-modal", // Group radios
                value: timeValue
            });
            const label = $("<label>")
                .attr("for", inputId)
                .text(`${timeValue} sa`)
                .attr("title", `${timeValue} saat (Kaydetmek için çift tıkla)`);

            // Double-click on label selects and saves
            label.on("dblclick", function () {
                $(this).prev('input[type="radio"]').prop("checked", true).trigger("change"); // Check and trigger change
                saveLog(); // Attempt to save
            });

            optionDiv.append(radioInput).append(label);
            modalTimeOptionsContainer.append(optionDiv);
        });
    }

    async function openLogModal(dateString, logIndex = -1) {
        logTargetDateInput.val(dateString); // Store date
        editingLogIndexInput.val(logIndex); // Store index (-1 for new)
        modalErrorMessage.text("").hide(); // Clear previous errors
        logTextInput.val(""); // Clear fields
        logTimeInput.val("");
        modalTimeOptionsContainer.find('input[name="duration-modal"]').prop("checked", false); // Uncheck radios
        hideJiraSearchResults(); // Ensure Jira results are hidden

        if (logIndex > -1) { // Editing existing log
            logModalTitle.text(`${dateString} - Log Düzenle`);
            deleteLogButton.show(); // Show delete button
            try {
                const logs = await getLogsForDate(dateString); // Get fresh copy of logs for the day
                const log = logs[logIndex];
                if (log) {
                    logTextInput.val(log.text);
                    logTimeInput.val(formatTime(log.time)); // Use formatTime for consistency
                    // Check the corresponding radio button if value matches
                    const matchingRadio = modalTimeOptionsContainer.find(`input[value="${log.time}"]`);
                    if (matchingRadio.length > 0) {
                        matchingRadio.prop("checked", true);
                    }
                } else {
                    // Log not found (potentially deleted/modified elsewhere)
                    console.error("Log edit error: Log not found at index.", dateString, logIndex);
                    showToast("Düzenlenecek log bulunamadı.");
                    closeLogModal();
                    return;
                }
            } catch (error) {
                 console.error("Error fetching log for editing:", error);
                 showToast("Log bilgileri alınırken hata oluştu.");
                 closeLogModal();
                 return;
            }
        } else { // Adding new log
            logModalTitle.text(`${dateString} - Yeni Log Ekle`);
            deleteLogButton.hide(); // Hide delete button
        }

        logInputOverlay.addClass("show"); // Show the modal
        // Focus the text input after a short delay to ensure it's visible
        setTimeout(() => logTextInput.focus(), 50);
    }

    function closeLogModal() {
        logInputOverlay.removeClass("show"); // Hide the modal
        modalErrorMessage.text("").hide(); // Clear errors
        hideJiraSearchResults(); // Hide Jira results
        // Optionally clear fields again on close?
        // logTextInput.val("");
        // logTimeInput.val("");
        // logTargetDateInput.val("");
        // editingLogIndexInput.val(-1);
        // modalTimeOptionsContainer.find('input[name="duration-modal"]').prop("checked", false);
    }

    async function saveLog() {
        modalErrorMessage.text("").hide(); // Clear previous errors
        const dateString = logTargetDateInput.val();
        const index = parseInt(editingLogIndexInput.val(), 10);
        let text = logTextInput.val().trim();
        let timeString = logTimeInput.val().trim().replace(",", "."); // Normalize decimal separator
        let timeValue;

        // Prioritize selected radio button for time
        const selectedRadio = modalTimeOptionsContainer.find("input:checked");
        if (selectedRadio.length > 0) {
            timeValue = parseFloat(selectedRadio.val());
        } else {
            // Try parsing time from text input (e.g., "Meeting 1.5h")
            const timeMatchInText = text.match(TIME_REGEX);
            if (timeMatchInText) {
                timeValue = parseFloat(timeMatchInText[1]);
                // Remove the time part from the description text
                text = text.substring(0, timeMatchInText.index).trim() + text.substring(timeMatchInText.index + timeMatchInText[0].length).trim();
                logTextInput.val(text); // Update input field to reflect removed time
            } else {
                // Fallback to parsing the dedicated time input field
                timeValue = parseFloat(timeString);
            }
        }

        // --- Validation ---
        if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            modalErrorMessage.text("Geçersiz tarih formatı.").show();
            return;
        }
        if (!text) {
            modalErrorMessage.text("Log açıklaması boş olamaz.").show();
            logTextInput.focus();
            return;
        }
        if (isNaN(timeValue) || timeValue <= 0) {
            modalErrorMessage.text("Geçerli bir süre girin (örn: 1.5).").show();
            // If time came from text, focus text; otherwise focus time input
            if (selectedRadio.length === 0 && !text.match(TIME_REGEX)) {
                 logTimeInput.focus();
            } else if (selectedRadio.length === 0) {
                 logTextInput.focus(); // Focus text if time was parsed from it
            }
            // If radio was selected but somehow invalid, focus the radio area or time input
            // else { logTimeInput.focus(); }
            return;
        }

        const logEntry = { text: text, time: timeValue }; // Timestamp added by add/update functions

        // --- Save Operation ---
        try {
            let action = "";
            // The updated add/update functions handle scroll restoration internally using scrollIntoView

            if (index > -1) { // Update existing
                await updateLogEntry(dateString, index, logEntry); // Calls the updated version
                action = "güncellendi";
            } else { // Add new
                await addLogEntry(dateString, logEntry); // Calls the updated version
                action = "eklendi";
            }

            showToast(`Log ${action}.`);
            closeLogModal(); // Close modal on success

            // Optional: Visual feedback on save button
            saveLogButton.addClass("saved-animation");
            setTimeout(() => saveLogButton.removeClass("saved-animation"), 600);

        } catch (e) {
            console.error("Save log error:", e);
            modalErrorMessage.text("Log kaydedilirken bir hata oluştu.").show();
            // Consider reloading logs to ensure consistency after failure
            await loadLogs();
            const targetDate = dateString; // Need date for potential scroll restore on error
            await renderCurrentCalendarView();
             // Attempt scroll restore after error render, with delay using scrollIntoView
             setTimeout(() => {
                 console.log(`Scrolling to day after saveLog error: ${targetDate}`);
                  const targetElement = $(`.day-item[data-date="${targetDate}"]`)[0];
                  if (targetElement) {
                    targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  }
             }, 0);
        }
    }


    async function deleteLog() {
        const dateString = logTargetDateInput.val();
        const index = parseInt(editingLogIndexInput.val(), 10);

        if (index > -1 && dateString) {
            if (confirm("Bu logu kalıcı olarak silmek istediğinizden emin misiniz?")) {
                try {
                    // The updated deleteLogEntry handles scroll restoration internally using scrollIntoView
                    await deleteLogEntry(dateString, index); // Perform deletion (calls updated version)

                    showToast("Log silindi.");
                    closeLogModal(); // Close modal on success

                } catch (e) {
                    console.error("Delete log error:", e);
                    modalErrorMessage.text("Log silinirken bir hata oluştu.").show();
                    // Consider reloading logs after failure
                    await loadLogs();
                    const targetDate = dateString; // Need date for scroll restore
                    await renderCurrentCalendarView();
                    // Attempt scroll restore after error render, with delay using scrollIntoView
                    setTimeout(() => {
                         console.log(`Scrolling to day after deleteLog error: ${targetDate}`);
                          const targetElement = $(`.day-item[data-date="${targetDate}"]`)[0];
                          if (targetElement) {
                            targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                          }
                     }, 0);
                }
            } else {
                console.log("Log deletion cancelled by user.");
            }
        } else {
            console.warn("Attempted delete with invalid date or index:", dateString, index);
            modalErrorMessage.text("Silinecek geçerli bir log bulunamadı.").show();
        }
    }


    function initializeModalListeners() {
        saveLogButton.on("click", saveLog);
        cancelLogButton.on("click", closeLogModal);
        deleteLogButton.on("click", deleteLog);

        // Close modal if clicking outside the content box
        logInputOverlay.on("click", function (e) {
            if ($(e.target).is(logInputOverlay)) { // Check if the click is directly on the overlay
                closeLogModal();
            }
        });

        // --- Input Field Listeners ---
        logTextInput.on("keydown", function (e) {
            const isJiraVisible = jiraSearchResultsContainer.is(":visible");

            if (e.key === "Enter" && !e.shiftKey && !isJiraVisible) { // Enter (without Shift) focuses time input
                e.preventDefault();
                logTimeInput.focus();
            } else if (e.key === "Escape") { // Escape closes Jira results or the modal
                if (isJiraVisible) {
                    hideJiraSearchResults();
                    e.stopPropagation(); // Prevent modal close if only closing Jira results
                } else {
                    closeLogModal();
                }
                e.preventDefault();
            } else if (isJiraVisible) { // Handle Jira navigation if visible
                 if (e.key === "ArrowDown") { e.preventDefault(); navigateJiraResults(1); }
                 else if (e.key === "ArrowUp") { e.preventDefault(); navigateJiraResults(-1); }
                 else if (e.key === "Enter") {
                     e.preventDefault();
                     const selectedResult = jiraSearchResultsContainer.find(".jira-result-item.selected");
                     if (selectedResult.length > 0) selectJiraResult(selectedResult);
                 }
            }
        });

        logTimeInput.on("keydown", function (e) {
            if (e.key === "Enter") { // Enter in time input saves the log
                e.preventDefault();
                saveLog();
            } else if (e.key === "Escape") {
                 e.preventDefault();
                 closeLogModal();
            }
        });

        // --- Time Radio Button Listeners ---
        modalTimeOptionsContainer.on("keydown", 'input[type="radio"]', function (e) {
            if (e.key === "Enter") { // Enter on radio saves
                e.preventDefault();
                saveLog();
            } else if (e.key === "ArrowRight" || e.key === "ArrowDown") { // Navigate radios right/down
                e.preventDefault();
                $(this).closest(".time-option").next(".time-option").find("input").focus().prop("checked", true).trigger("change");
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { // Navigate radios left/up
                e.preventDefault();
                $(this).closest(".time-option").prev(".time-option").find("input").focus().prop("checked", true).trigger("change");
            } else if (e.key === "Escape") {
                 e.preventDefault();
                 closeLogModal();
            }
        });

        // Update time input field when a radio button is changed
        modalTimeOptionsContainer.on("change", 'input[type="radio"]', function () {
            if ($(this).is(":checked")) {
                logTimeInput.val(formatTime(parseFloat($(this).val())));
            }
        });

        // --- Jira Autocomplete Listener ---
        logTextInput.on("input", function () {
            // Basic check for Jira credentials
            if (!userSettings.jiraUrl || !userSettings.jiraToken) return;

            const currentText = $(this).val();
            const cursorPos = this.selectionStart; // Get cursor position
            const textBeforeCursorContent = currentText.substring(0, cursorPos);

            // Check if text immediately before cursor looks like a Jira key being typed
            const match = textBeforeCursorContent.match(JIRA_SEARCH_TRIGGER_REGEX);

            if (match && match[1] && match[1].length >= JIRA_SEARCH_MIN_LENGTH) {
                 // Ensure the match ends at the cursor position
                 if (match.index + match[0].length === cursorPos) {
                     const searchTerm = match[1];
                     console.log("Potential Jira trigger term:", searchTerm);
                     debouncedJiraSearch(searchTerm); // Trigger debounced search
                 } else {
                     // Match found but not at the cursor, likely already completed or edited
                     hideJiraSearchResults();
                     if (jiraSearchDebounceTimer) clearTimeout(jiraSearchDebounceTimer);
                 }
            } else {
                // No potential Jira key pattern found before cursor
                hideJiraSearchResults();
                if (jiraSearchDebounceTimer) clearTimeout(jiraSearchDebounceTimer);
            }
        });


        // Close Jira results if clicking anywhere else on the document
        $(document).on("click", function (e) {
            // Check if the click target is outside the Jira input wrapper AND outside the results container
            if (!$(e.target).closest(".jira-input-wrapper").length && !$(e.target).closest("#jira-search-results-container").length) {
                hideJiraSearchResults();
            }
        });

        // Handle click on a Jira result item
        jiraSearchResultsContainer.on("click", ".jira-result-item", function () {
            selectJiraResult($(this));
        });
    }

    // --- Jira Integration ---
    function debouncedJiraSearch(term) {
        clearTimeout(jiraSearchDebounceTimer); // Clear previous timer
        // Show loading indicator immediately
        jiraSearchResultsContainer.html('<div class="jira-loading"><i class="fa-solid fa-spinner fa-spin"></i> Aranıyor...</div>').show();

        jiraSearchDebounceTimer = setTimeout(async () => {
            // Double-check credentials before sending request
            if (!userSettings.jiraUrl || !userSettings.jiraToken) {
                hideJiraSearchResults();
                return;
            }
            try {
                console.log(`Searching Jira for: "${term}"`);
                // Send message to background script to perform the search
                const response = await chrome.runtime.sendMessage({ action: "searchJiraIssues", searchTerm: term });

                // Handle potential errors from sendMessage itself
                if (chrome.runtime.lastError) {
                    throw new Error(chrome.runtime.lastError.message || "Mesaj gönderme hatası");
                }

                // Process the response from the background script
                if (response && response.success && Array.isArray(response.data)) {
                    populateJiraSearchResults(response.data, term); // Populate results on success
                } else {
                    const errorMsg = response?.error || "Bilinmeyen arama hatası";
                    console.error("Jira search failed:", errorMsg);
                    jiraSearchResultsContainer.html(`<div class="jira-error">Hata: ${errorMsg}</div>`).show();
                }
            } catch (e) {
                console.error("Error during Jira search:", e);
                jiraSearchResultsContainer.html(`<div class="jira-error">Arama sırasında hata: ${e.message}</div>`).show();
            }
        }, JIRA_SEARCH_DEBOUNCE_MS); // Wait before sending request
    }

    function populateJiraSearchResults(issues, searchTerm) {
        jiraSearchResultsContainer.empty(); // Clear previous results or loading indicator

        if (issues.length === 0) {
            jiraSearchResultsContainer.html('<div class="jira-no-results">Sonuç bulunamadı.</div>');
            jiraSearchResultsContainer.show();
            return;
        }

        const list = $("<ul></ul>");
        issues.forEach(issue => {
            const item = $("<li>")
                .addClass("jira-result-item")
                .attr({
                    "data-key": issue.key,
                    "data-summary": issue.summary || "",
                    "data-term": searchTerm, // Store the term that triggered this result
                    title: `${issue.key} - ${issue.summary || "(Özet yok)"}` // Tooltip
                });

            const keySpan = $("<span>").addClass("jira-result-key").text(issue.key);
            const summarySpan = $("<span>").addClass("jira-result-summary").text(issue.summary || "(Özet yok)");

            item.append(keySpan).append(summarySpan);
            list.append(item);
        });

        jiraSearchResultsContainer.append(list);
        jiraSearchResultsContainer.show();

        // Select the first item by default for keyboard navigation
        if (list.children().length > 0) {
            list.children().first().addClass("selected");
        }
    }

    function hideJiraSearchResults() {
        jiraSearchResultsContainer.hide().empty(); // Hide and clear content
    }

    function selectJiraResult(resultElement) {
        const key = resultElement.data("key");
        const summary = resultElement.data("summary");
        const term = resultElement.data("term"); // The search term that was typed
        const currentText = logTextInput.val();
        const cursorPos = logTextInput[0].selectionStart;
        const textBeforeCursorContent = currentText.substring(0, cursorPos);

        // Find the last occurrence of the search term *ending* at the cursor position
        const startIndex = textBeforeCursorContent.lastIndexOf(term);

        if (startIndex === -1 || (startIndex + term.length !== textBeforeCursorContent.length)) {
            // Fallback: If term wasn't found right before cursor, append the selection
            console.warn("Could not find exact term before cursor for replacement. Appending.", term, textBeforeCursorContent);
            const separator = currentText.length > 0 && !currentText.endsWith(' ') ? ' ' : ''; // Add space if needed
            const newText = `${currentText}${separator}${key} - ${summary} `;
            logTextInput.val(newText);
        } else {
            // Replace the typed term with the full Jira key and summary
            const textBeforeTerm = currentText.substring(0, startIndex);
            const textAfterCursorContent = currentText.substring(cursorPos); // Text after the original cursor
            const replacementText = `${key} - ${summary} `; // Add trailing space
            const newText = `${textBeforeTerm}${replacementText}${textAfterCursorContent}`;
            logTextInput.val(newText);

            // Set cursor position after the inserted text
            const newCursorPos = startIndex + replacementText.length;
            // Use setTimeout to ensure focus and selection happen after potential DOM updates
            setTimeout(() => {
                logTextInput.focus();
                if (logTextInput[0].setSelectionRange) {
                    logTextInput[0].setSelectionRange(newCursorPos, newCursorPos);
                }
            }, 0);
        }

        hideJiraSearchResults(); // Hide results after selection
    }


    function navigateJiraResults(direction) {
        const items = jiraSearchResultsContainer.find(".jira-result-item");
        if (items.length === 0) return; // No items to navigate

        let currentIndex = items.filter(".selected").index(); // Get index of currently selected item

        // Calculate next index based on direction
        let nextIndex = currentIndex + direction;

        // Handle wrap-around
        if (nextIndex >= items.length) {
            nextIndex = 0; // Wrap to start
        } else if (nextIndex < 0) {
            nextIndex = items.length - 1; // Wrap to end
        }

        // Update selected class
        items.removeClass("selected");
        const nextItem = items.eq(nextIndex).addClass("selected");

        // Scroll the newly selected item into view if needed
        nextItem[0]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    async function fetchAndShowJiraSummary(issueKey) {
        showToast(`Jira ${issueKey} özeti yükleniyor...`, 2000);
        try {
            // Check prerequisites
            if (!userSettings.jiraUrl || !userSettings.jiraEmail || !userSettings.jiraToken) {
                showToast("Jira ayarları eksik veya hatalı.", 4000);
                return;
            }
            if (!userSettings.jiraUrl.startsWith("http")) {
                showToast(`Geçersiz Jira URL: ${userSettings.jiraUrl}`, 4000);
                return;
            }

            // Send message to background script
            const response = await chrome.runtime.sendMessage({ action: "getJiraSummary", issueKey: issueKey });

            // Handle runtime errors during message sending
            if (chrome.runtime.lastError) {
                const error = chrome.runtime.lastError;
                console.error("Log.js (getJiraSummary) Runtime error:", error);
                showToast(`Jira bağlantı hatası: ${error.message || "Bilinmeyen"}`, 4000);
                return;
            }

            // Process response from background script
            if (response?.success && response.data?.summary) {
                console.log("Jira Summary:", response.data.summary);
                // Show summary in a toast (consider a more persistent display if needed)
                showToast(`Jira ${issueKey}: ${response.data.summary}`, 5000);
            } else {
                const errorMsg = response?.error || "API Hatası veya Özet Bulunamadı";
                console.error("Jira fetch summary error:", errorMsg);
                showToast(`Jira ${issueKey} özeti alınamadı: ${errorMsg}`, 4000);
            }
        } catch (e) {
            // Catch errors in the try block itself (e.g., unexpected issues)
            console.error("Log.js (getJiraSummary) Send/Processing error:", e);
            showToast(`Jira özeti alınırken kritik hata: ${e.message || e}`, 4000);
        }
    }

    // --- Drag and Drop --- Updated Function Start ---
    function initializeDragAndDrop() {
        calendarView.off(".logDnD"); // Remove previous DnD listeners

        // --- Drag Start ---
        calendarView.on("dragstart.logDnD", ".log-item:not(.disabled-log)", function (e) {
            // Ensure there are logs to drag from
            if (Object.keys(allLogs).length === 0) { e.preventDefault(); return; }
            draggedLogElement = this; // Store the DOM element being dragged
            const $logItem = $(this);
            const index = parseInt($logItem.data("log-index"), 10);
            const date = $logItem.data("date");
            const logData = allLogs[date]?.[index]; // Find the corresponding log data
            if (!logData) { console.error("Drag start error: Log data not found for", date, index); e.preventDefault(); resetDragState(); return; }
            // Store essential log data along with original position
            draggedLogData = { ...logData, originalDate: date, originalIndex: index };
            // Set drag effect and data transfer (primarily for visual feedback)
            e.originalEvent.dataTransfer.effectAllowed = "move";
            try { e.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({ date: date, index: index })); } catch (err) { console.warn("Setting dataTransfer failed:", err); }
            // Add styling classes
            $logItem.addClass("dragging");
            $("body").addClass("dragging-log"); // Class for global styles (e.g., cursor)
            console.log(`Drag Start: ${date}[${index}] - ${logData.text}`);
        });

        // --- Drag Over --- (Highlighting potential drop targets)
        // Over a valid day item (non-holiday)
        calendarView.on("dragover.logDnD", ".day-item:not(.holiday-disabled)", function (e) {
            if (draggedLogData) { // Check if a drag operation is in progress
                e.preventDefault(); // Allow drop
                e.originalEvent.dataTransfer.dropEffect = "move"; // Indicate 'move' operation
                $(this).addClass("drag-over"); // Highlight the day item
                // If dragging over a *different* day, remove intra-day indicators
                if ($(this).data("date") !== draggedLogData.originalDate) {
                     $(".log-list .drop-indicator").remove(); // Clear insertion markers
                     dropTargetIndex = -1; // Reset index for inter-day drop
                }
            }
        });
        // Over the log list or another log item within the *same* day (for reordering)
        calendarView.on("dragover.logDnD", ".log-list, .log-item:not(.disabled-log)", function (e) {
             if (!draggedLogData) return; // Must be dragging something
             const $target = $(e.target);
             const $dayItem = $target.closest(".day-item");
             const targetDate = $dayItem.data("date");
             // Only allow reordering within the original day
             if (targetDate !== draggedLogData.originalDate) { return; }
             e.preventDefault(); // Allow drop
             e.stopPropagation(); // Prevent event bubbling to day-item dragover
             e.originalEvent.dataTransfer.dropEffect = "move";
             $dayItem.addClass("drag-over"); // Ensure day is highlighted
             // --- Calculate Insertion Point ---
             $(".log-list .drop-indicator").remove(); // Remove previous indicators
             const $logList = $target.closest(".log-list");
             const $targetLogItem = $target.closest(".log-item");
             if ($targetLogItem.length > 0 && $targetLogItem[0] !== draggedLogElement) {
                 // Dragging over another log item
                 const rect = $targetLogItem[0].getBoundingClientRect();
                 const mouseY = e.originalEvent.clientY;
                 const midY = rect.top + rect.height / 2;
                 dropTargetIndex = parseInt($targetLogItem.data("log-index"), 10);
                 // Insert indicator before or after based on mouse position
                 if (mouseY < midY) { $targetLogItem.before('<li class="drop-indicator"></li>'); }
                 else { $targetLogItem.after('<li class="drop-indicator"></li>'); dropTargetIndex++; }
             } else if ($logList.length > 0 && ($target.is(".log-list") || $target.is(".no-logs"))) {
                  // Dragging over the empty list area or the "no logs" placeholder
                  dropTargetIndex = $logList.children(".log-item:not(.dragging)").length; // Target index is the end
                  $logList.append('<li class="drop-indicator"></li>'); // Add indicator at the end
             } else { dropTargetIndex = -1; } // Dragging over self or invalid area
        });

        // --- Drag Leave --- (Removing highlights)
        calendarView.on("dragleave.logDnD", ".day-item, .log-list, .log-item", function (e) {
            // Use setTimeout to check relatedTarget after a small delay
            setTimeout(() => {
                const $currentTarget = $(this);
                const $relatedTarget = $(e.relatedTarget); // Element being entered
                const $dayItem = $currentTarget.closest(".day-item");
                // If the related target is null (left window) or outside the current day item, remove highlights
                if (!$relatedTarget.length || !$relatedTarget.closest(".day-item").is($dayItem)) {
                    $dayItem.removeClass("drag-over");
                    $(".log-list .drop-indicator").remove(); // Remove insertion marker
                    if ($currentTarget.is(".day-item")) { dropTargetIndex = -1; } // Reset index if leaving day
                }
            }, 10); // Small delay
        });

        // --- Drop ---
        calendarView.on('drop.logDnD', '.day-item:not(.holiday-disabled), .log-list', async function (e) {
            e.preventDefault();
            e.stopPropagation(); // Prevent default drop behavior and bubbling

            const $targetElement = $(e.target);
            const $targetDayItem = $targetElement.closest('.day-item');
            const targetDate = $targetDayItem.data('date'); // The date where the drop occurred

            // --- Cleanup visual indicators ---
            $('.log-list .drop-indicator').remove();
            $('.day-item.drag-over').removeClass('drag-over');

            // --- Validate state ---
            if (!draggedLogData || !draggedLogElement || !targetDate) {
                console.warn("Drop error: Invalid drag state or target date.");
                resetDragState();
                return;
            }

            const sourceDate = draggedLogData.originalDate;
            const sourceIndex = draggedLogData.originalIndex;

            // Store the target date string to scroll to after render
            const dateToScrollTo = targetDate;
            console.log(`Drop detected. Will scroll to target date: ${dateToScrollTo} after operation.`);

            // --- Handle Drop Logic ---
            try {
                if (sourceDate === targetDate) {
                    // --- Intra-day Reorder ---
                    // Check if the drop position is valid and results in a change
                    if (dropTargetIndex === -1 || dropTargetIndex === sourceIndex || dropTargetIndex === sourceIndex + 1) {
                        console.log("Drop: No effective change in order.");
                        resetDragState(); // No actual move needed
                        return; // Exit without re-rendering
                    }
                    console.log(`Reordering log within ${sourceDate}: from index ${sourceIndex} to target ${dropTargetIndex}`);
                    if (!allLogs[sourceDate]?.[sourceIndex]) { throw new Error("Source log for reorder not found."); }

                    // 1. Get the log to move
                    const logToMove = { ...allLogs[sourceDate][sourceIndex] };
                    // 2. Remove from original position
                    allLogs[sourceDate].splice(sourceIndex, 1);
                    // 3. Calculate actual insertion index (adjusting for removal)
                    const actualInsertionIndex = dropTargetIndex > sourceIndex ? dropTargetIndex - 1 : dropTargetIndex;
                    // 4. Insert at the new position
                    allLogs[sourceDate].splice(actualInsertionIndex, 0, logToMove);
                    // 5. Update timestamps to reflect new order
                    allLogs[sourceDate].forEach((log, idx) => { log.timestamp = Date.now() + idx; });

                    // 6. Save the updated logs
                    await saveLogs(allLogs);
                    // 7. Re-render the calendar view
                    await renderCurrentCalendarView();
                    // 8. Restore scroll using scrollIntoView after render, with delay
                    setTimeout(() => {
                         console.log(`Scrolling to day after intra-day reorder: ${dateToScrollTo}`);
                         const targetElement = $(`.day-item[data-date="${dateToScrollTo}"]`)[0];
                         if (targetElement) {
                             // Scroll the target day element into view
                             targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                         }
                    }, 0); // Use 0ms delay to push to end of execution queue
                    showToast(`Log ${sourceDate} içinde yeniden sıralandı.`);

                } else {
                    // --- Inter-day Move ---
                    console.log(`Moving log from ${sourceDate}[${sourceIndex}] to ${targetDate}`);
                    if (!allLogs[sourceDate]?.[sourceIndex]) { throw new Error("Source log for move not found."); }

                    // 1. Get the log data (create new object, update timestamp)
                    const logToMove = { text: allLogs[sourceDate][sourceIndex].text, time: allLogs[sourceDate][sourceIndex].time, timestamp: Date.now() };
                    // 2. Remove from the source day
                    allLogs[sourceDate].splice(sourceIndex, 1);
                    if (allLogs[sourceDate].length === 0) { delete allLogs[sourceDate]; } // Clean up empty source day
                    // 3. Add to the target day (initialize if needed)
                    if (!allLogs[targetDate]) { allLogs[targetDate] = []; }
                    allLogs[targetDate].push(logToMove);
                    // Optional: Sort target day logs by timestamp

                    // 4. Save the updated logs
                    await saveLogs(allLogs);
                    // 5. Re-render the calendar view
                    await renderCurrentCalendarView();
                    // 6. Restore scroll using scrollIntoView after render, with delay
                    setTimeout(() => {
                         console.log(`Scrolling to day after inter-day move: ${dateToScrollTo}`);
                         const targetElement = $(`.day-item[data-date="${dateToScrollTo}"]`)[0];
                         if (targetElement) {
                              // Scroll the target day element into view
                              targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                         }
                    }, 0); // Use 0ms delay
                    showToast(`Log "${logToMove.text.substring(0, 15)}..." ${targetDate} tarihine taşındı.`);
                }
            } catch (err) {
                console.error("Drop operation failed:", err);
                showToast("Log taşıma/sıralama sırasında hata oluştu.");
                // Attempt to recover by reloading logs and re-rendering
                await loadLogs();
                await renderCurrentCalendarView();
                // Try restoring scroll even after error recovery, with delay
                setTimeout(() => {
                     console.log(`Scrolling to day after drop error: ${dateToScrollTo}`);
                     const targetElement = $(`.day-item[data-date="${dateToScrollTo}"]`)[0];
                     if (targetElement) {
                        targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                     }
                }, 0);
            } finally {
                // --- Reset state regardless of success or failure ---
                resetDragState();
            }
        });


        // --- Drag End --- (Cleanup)
        calendarView.on("dragend.logDnD", ".log-item", function (e) {
            console.log("Drag End");
            // Cleanup is handled by the drop handler or this reset if drop didn't occur on a valid target
            resetDragState();
        });

        // --- Drag Leave Body --- (Safety net cleanup)
        $("body").on("dragleave", function (e) {
            // Check if the mouse left the viewport entirely
            if (e.originalEvent.relatedTarget === null || e.originalEvent.relatedTarget === document.documentElement) {
                console.log("Dragleave body detected.");
                resetDragState(); // Clean up if drag leaves the window
            }
        });
    }
    // --- Drag and Drop --- Updated Function End ---

    function resetDragState() {
        // Remove visual cues
        if (draggedLogElement) {
            $(draggedLogElement).removeClass("dragging");
        }
        $(".day-item.drag-over").removeClass("drag-over");
        $(".log-list .drop-indicator").remove();
        $("body.dragging-log").removeClass("dragging-log");

        // Clear state variables
        draggedLogData = null;
        draggedLogElement = null;
        dropTargetIndex = -1;
        // console.log("Drag state reset."); // Can be noisy, enable if needed
    }

    // --- Utility Functions ---
    async function copyDayLogsToClipboard(dateString, buttonElement) {
        const logs = await getLogsForDate(dateString); // Get a fresh copy
        if (!logs || logs.length === 0) {
            showToast("Bu tarihte kopyalanacak log bulunmuyor.");
            return;
        }

        // Format logs for clipboard
        const formattedLogs = logs
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)) // Sort by timestamp first
            .map(item => `- ${item.text} (${formatTime(item.time)} sa)`)
            .join("\n");
        const totalTime = logs.reduce((sum, item) => sum + parseFloat(item.time || 0), 0);
        const clipboardContent = `${dateString} Eforları:\n${formattedLogs}\nToplam: ${formatTime(totalTime)} sa`;

        try {
            await navigator.clipboard.writeText(clipboardContent);
            showToast("Günlük loglar panoya kopyalandı!");

            // Visual feedback on the button
            const originalIcon = buttonElement.html(); // Store original icon
            buttonElement.html('<i class="fa-solid fa-check"></i>').addClass("copied");
            setTimeout(() => {
                buttonElement.html(originalIcon).removeClass("copied"); // Restore icon
            }, 1500); // Duration of feedback

        } catch (e) {
            console.error("Clipboard write error:", e);
            showToast("Panoya kopyalama başarısız oldu.");
        }
    }

    async function handleCopyToNextDay(buttonElement) {
        const sourceDateString = buttonElement.closest(".day-item").data("date");
        let nextDayDate = new Date(sourceDateString); // Start from the source date
        let attempts = 0;
        const maxAttempts = 14; // Limit search to prevent infinite loops

        // Find the next valid working day (not weekend, not holiday)
        do {
            nextDayDate.setDate(nextDayDate.getDate() + 1); // Increment day
            attempts++;
            const nextDayString = getLocalISODateString(nextDayDate);
            const dayOfWeek = nextDayDate.getDay(); // 0=Sun, 6=Sat
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isHoliday = holidays.some(h => h.date === nextDayString);

            if (!isWeekend && !isHoliday) {
                // Found the next working day
                await performCopy(sourceDateString, nextDayString, buttonElement); // Calls updated performCopy
                return; // Exit after successful copy
            }
        } while (attempts < maxAttempts);

        // If loop finishes without finding a day
        showToast(`Sonraki ${maxAttempts} gün içinde uygun bir iş günü bulunamadı.`);
    }

    // --- Utility Functions --- Updated performCopy Start ---
    async function performCopy(sourceDateString, targetDateString, buttonElement) {
        const sourceLogs = await getLogsForDate(sourceDateString);
        if (!sourceLogs || sourceLogs.length === 0) {
            showToast("Kaynak tarihte kopyalanacak log yok.");
            return;
        }

        if (!confirm(`'${sourceDateString}' loglarını '${targetDateString}' tarihine kopyalamak istediğinizden emin misiniz? (Mevcut loglar korunur)`)) {
            showToast("Kopyalama iptal edildi.");
            return;
        }

        try {
            // Create deep copies of logs with new timestamps
            const logsToCopy = sourceLogs.map((log, idx) => ({
                text: log.text,
                time: log.time,
                timestamp: Date.now() + idx // Assign new timestamp for ordering
            }));

            // Initialize target day if it doesn't exist, then append
            if (!allLogs[targetDateString]) {
                allLogs[targetDateString] = [];
            }
            allLogs[targetDateString].push(...logsToCopy); // Append new logs

            // --- Save, Render, Restore Scroll ---
            await saveLogs(allLogs);
            const dateToScrollTo = targetDateString; // Target date for scrolling
            await renderCurrentCalendarView();
            // Restore scroll AFTER render, with delay using scrollIntoView
            setTimeout(() => {
                 console.log(`Scrolling to day after performCopy: ${dateToScrollTo}`);
                 const targetElement = $(`.day-item[data-date="${dateToScrollTo}"]`)[0];
                 if (targetElement) {
                     // Scroll the target day element into view
                     targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                 }
            }, 0);

            showToast(`${sourceDateString} logları ${targetDateString} tarihine kopyalandı.`);

            // Visual feedback on button
            const originalIcon = buttonElement.html();
            buttonElement.html('<i class="fa-solid fa-check"></i>').addClass('copied');
            setTimeout(() => buttonElement.html(originalIcon).removeClass('copied'), 1500);

        } catch (e) {
            console.error("Copy to next day error:", e);
            showToast("Logları kopyalarken bir hata oluştu.");
            // Attempt recovery
            await loadLogs();
            const dateToScrollTo = targetDateString; // Ensure defined for error case
            await renderCurrentCalendarView();
             // Restore scroll after error, with delay using scrollIntoView
             setTimeout(() => {
                 console.log(`Scrolling to day after copy error: ${dateToScrollTo}`);
                  const targetElement = $(`.day-item[data-date="${dateToScrollTo}"]`)[0];
                  if (targetElement) {
                    targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  }
             }, 0);
        }
    }
    // --- Utility Functions --- Updated performCopy End ---


    // --- Summary View ---
    async function loadAndRenderSummary() {
        summaryContainer.empty().append('<div class="loading-spinner"></div><p class="loading-text">Özet yükleniyor...</p>');
        try {
            const year = currentYear; // Use the currently selected year
            const logsForYear = filterLogsForYear(allLogs, year); // Get logs for this year

            // Basic HTML structure for summary widgets
            summaryContainer.html(`
                <h2 class="summary-title">${year} Yılı Özeti</h2>
                <div class="summary-grid">
                    <div id="cal-heatmap-widget" class="summary-widget">
                        <h3><i class="fa-solid fa-th"></i> Efor Yoğunluğu (Yıl)</h3>
                        <div id="cal-heatmap-graph"></div>
                        <div id="cal-heatmap-legend"></div>
                    </div>
                    <div id="hourglass-chart-widget" class="summary-widget">
                        <h3><i class="fa-solid fa-chart-column"></i> Aylık Dağılım</h3>
                        <div class="chart-container">
                            <canvas id="hourglassCanvas"></canvas>
                        </div>
                    </div>
                    <div id="fun-facts-widget" class="summary-widget">
                        <h3><i class="fa-solid fa-lightbulb"></i> İstatistikler</h3>
                        <ul id="fun-facts-list"></ul>
                    </div>
                </div>
            `);

            // Render the individual components
            renderEffortHeatmap(logsForYear, year);
            renderHourglassChart(logsForYear); // Renamed from hourglass to monthly bar
            renderFunFacts(logsForYear);

        } catch (e) {
            console.error("Error loading or rendering summary:", e);
            summaryContainer.html('<p class="error">Özet yüklenirken bir hata oluştu.</p>');
        }
    }

    function filterLogsForYear(logs, year) {
        // Filters the main log object to include only entries for the specified year.
        if (typeof logs !== "object" || logs === null || isNaN(year)) {
            console.warn("Invalid input for filterLogsForYear:", logs, year);
            return {};
        }
        const yearString = year.toString();
        const filteredLogs = {};
        for (const dateString in logs) {
            if (dateString.startsWith(yearString + "-")) {
                // Deep copy log entries to avoid modifying the original allLogs
                filteredLogs[dateString] = JSON.parse(JSON.stringify(logs[dateString]));
            }
        }
        return filteredLogs;
    }

    function renderEffortHeatmap(logs, year) {
        const container = $("#cal-heatmap-graph");
        const legendContainer = $("#cal-heatmap-legend");
        container.empty(); // Clear previous heatmap
        legendContainer.empty(); // Clear previous legend

        // Check for library dependencies
        if (typeof CalHeatmap === "undefined" || typeof d3 === "undefined" || typeof dayjs === "undefined") {
            const missingLibs = [
                typeof CalHeatmap === "undefined" ? "CalHeatmap" : null,
                typeof d3 === "undefined" ? "D3.js" : null,
                typeof dayjs === "undefined" ? "Day.js" : null
            ].filter(Boolean).join(", ");
            container.html(`<p class="error-subtle">Grafik kütüphaneleri yüklenemedi: ${missingLibs}.</p>`);
            console.error("Heatmap dependencies missing:", missingLibs);
            return;
        }
        // Check for Day.js locale (required by CalHeatmap)
        if (!dayjs.Ls || !dayjs.Ls.tr) {
            container.html(`<p class="error-subtle">Day.js 'tr' (Türkçe) yerelleştirme dosyası yüklenemedi.</p>`);
            console.error("Day.js 'tr' locale is missing.");
            return;
        }

        // Destroy previous instance if it exists
        if (chartInstances.heatmap) {
            try { chartInstances.heatmap.destroy(); } catch (e) { console.error("Error destroying previous heatmap:", e); }
            chartInstances.heatmap = null;
        }

        // --- Prepare Data for Heatmap ---
        const heatmapData = {};
        let maxDailyHours = 0;
        for (const date in logs) {
            const totalTime = logs[date].reduce((sum, log) => sum + parseFloat(log.time || 0), 0);
            if (totalTime > 0) {
                // CalHeatmap expects timestamps in seconds
                const timestampInSeconds = dayjs(date).startOf('day').unix();
                heatmapData[timestampInSeconds] = totalTime;
                if (totalTime > maxDailyHours) maxDailyHours = totalTime;
            }
        }

        // --- Configure Heatmap ---
        // Define color scale steps based on max hours logged in a day
        const steps = maxDailyHours > 8 ? [1, 2, 4, 8, Math.ceil(maxDailyHours)] : // Dynamic steps if > 8h
                       maxDailyHours > 0 ? [0.5, 1, 2, 4, 8] : // Standard steps if <= 8h
                       [1]; // Default step if no logs
        if (maxDailyHours === 0) steps[0] = 1; // Ensure at least one step if empty

        const currentTheme = bodyElement.hasClass("light-theme") ? "light" : "dark";
        // Define color ranges for light and dark themes (GitHub-like)
        const colorScheme = currentTheme === "light"
            ? ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"] // Light theme colors
            : ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]; // Dark theme colors

        try {
            console.log("Rendering Heatmap for year:", year);
            dayjs.locale("tr"); // Ensure Turkish locale is active for month names etc.
            chartInstances.heatmap = new CalHeatmap();
            chartInstances.heatmap.paint(
                {
                    itemSelector: container[0], // Target DOM element
                    data: {
                        source: heatmapData, // Data prepared above
                        type: "json",
                        x: "ts", // Property name for timestamp (seconds)
                        y: "value" // Property name for hour value
                    },
                    date: { start: new Date(year, 0, 1) }, // Start date of the heatmap (Jan 1st)
                    range: 12, // Display 12 months
                    scale: {
                        color: {
                            type: "threshold", // Use threshold scale based on steps
                            domain: steps, // Steps defined above
                            range: colorScheme // Colors defined above
                        }
                    },
                    domain: { // Configuration for month sections
                        type: "month",
                        padding: [5, 5, 5, 5], // Padding around months
                        label: { // Month labels (e.g., "Oca")
                            text: (d) => dayjs(d).format("MMM"), // Use Day.js for formatting
                            position: "top",
                            textAlign: "start",
                            width: 30
                        }
                    },
                    subDomain: { // Configuration for individual day cells
                        type: "ghDay", // GitHub-style day cell
                        radius: 2, // Rounded corners
                        width: 11, height: 11, // Cell size
                        gutter: 3, // Spacing between cells
                        // Tooltip content on hover
                        label: (d, v) => `${dayjs(d).format("YYYY-MM-DD")}: ${v ? formatTime(v) + " sa" : "Kayıt Yok"}`
                    },
                    legend: { // Color legend configuration
                        show: true,
                        itemSelector: legendContainer[0], // Target DOM element for legend
                        label: " saat", // Label for legend values
                        width: 200, // Legend width
                        verticalPosition: "bottom",
                        tickSize: 0 // Hide ticks on legend scale
                    },
                    animationDuration: 300, // Smooth transition duration
                },
                 // --- Event Listeners ---
                 [
                     [ // CalHeatmap v4 listener format
                         CalHeatmap.Tooltip, // Enable tooltips plugin
                         { enabled: true }
                     ],
                     [ // Custom onClick listener
                         {
                              name: 'onClick', // Internal name
                              listener: (event, timestamp, value) => { // Listener function
                                   const dateStr = dayjs.unix(timestamp).format('YYYY-MM-DD');
                                   console.log(`Heatmap click: Date=${dateStr}, Value=${value}`);
                                   // Open log modal for the clicked date
                                   // Check if it's a holiday first? Maybe not necessary here.
                                   openLogModal(dateStr);
                              }
                         }
                     ]
                 ]
            );
            console.log("Heatmap rendered successfully.");
        } catch (e) {
            console.error("Heatmap rendering failed:", e);
            container.html(`<p class="error-subtle">Yoğunluk haritası oluşturulurken hata: ${e.message}.</p>`);
        }
    }


    function renderHourglassChart(logs) { // Renamed to reflect it's a monthly bar chart
        const canvas = document.getElementById("hourglassCanvas");
        if (!canvas) {
            console.error("Hourglass chart canvas element not found.");
            return;
        }
        const ctx = canvas.getContext("2d");

        // Check for Chart.js dependency
        if (typeof Chart === "undefined") {
            $(canvas).parent().html('<p class="error-subtle">Grafik kütüphanesi (Chart.js) yüklenemedi.</p>'); // Replace canvas container
            console.error("Chart.js library is missing.");
            return;
        }

        // Destroy previous instance if it exists
        if (chartInstances.monthly) {
            try { chartInstances.monthly.destroy(); } catch (e) { console.error("Error destroying previous monthly chart:", e); }
            chartInstances.monthly = null;
        }

        // --- Prepare Data for Monthly Bar Chart ---
        const monthlyTotals = Array(12).fill(0); // Initialize array for 12 months
        for (const date in logs) {
            const monthIndex = parseInt(date.split("-")[1], 10) - 1; // Get month index (0-11)
            if (monthIndex >= 0 && monthIndex < 12) {
                monthlyTotals[monthIndex] += logs[date].reduce((sum, log) => sum + parseFloat(log.time || 0), 0);
            }
        }

        // --- Configure Chart ---
        const theme = bodyElement.hasClass("light-theme") ? "light" : "dark";
        const colors = getChartThemeColors(theme); // Get theme-specific colors

        try {
            console.log("Rendering Monthly Bar Chart...");
            chartInstances.monthly = new Chart(ctx, {
                type: "bar", // Bar chart
                data: {
                    labels: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"], // Turkish month abbreviations
                    datasets: [{
                        label: "Toplam Saat", // Dataset label
                        data: monthlyTotals, // Monthly totals calculated above
                        backgroundColor: colors.barColor, // Bar fill color
                        borderColor: colors.borderColor, // Bar border color
                        borderWidth: 1, // Bar border width
                        borderRadius: 3, // Rounded corners for bars
                        barPercentage: 0.8, // Width of bar relative to available space
                        categoryPercentage: 0.7 // Width of category space used by bars
                    }]
                },
                options: {
                    responsive: true, // Make chart responsive
                    maintainAspectRatio: false, // Allow chart to fill container height
                    plugins: {
                        legend: { display: false }, // Hide legend (only one dataset)
                        tooltip: { // Configure tooltips
                            callbacks: {
                                // Format tooltip label to show hours correctly
                                label: (context) => `${context.dataset.label}: ${formatTime(context.parsed.y)} sa`
                            }
                        }
                    },
                    scales: {
                        y: { // Y-axis configuration (Hours)
                            beginAtZero: true, // Start axis at 0
                            title: { display: true, text: "Saat", color: colors.labelColor }, // Axis title
                            grid: { color: colors.gridColor }, // Grid line color
                            ticks: { color: colors.labelColor, precision: 0 } // Tick label color and precision
                        },
                        x: { // X-axis configuration (Months)
                            grid: { display: false }, // Hide vertical grid lines
                            ticks: { color: colors.labelColor } // Tick label color
                        }
                    },
                    // Change cursor on hover over bars
                    onHover: (event, chartElements) => {
                        event.native.target.style.cursor = chartElements.length > 0 ? "pointer" : "default";
                    },
                    // Handle clicks on bars
                    onClick: (event, chartElements) => {
                        if (chartElements.length > 0) {
                            const clickedIndex = chartElements[0].index; // Get index of clicked bar (0-11)
                            console.log("Month bar clicked:", clickedIndex);
                            currentMonth = clickedIndex; // Set the current month
                            // currentYear remains the same (as set by summary view)
                            switchView("calendar-view"); // Switch to calendar view for the selected month
                        }
                    }
                }
            });
            console.log("Monthly bar chart rendered successfully.");
        } catch (e) {
            console.error("Monthly bar chart rendering failed:", e);
            $(canvas).parent().html(`<p class="error-subtle">Aylık dağılım grafiği oluşturulurken hata: ${e.message}.</p>`);
        }
    }


    function renderFunFacts(logs) {
        const listElement = $("#fun-facts-list");
        listElement.empty(); // Clear previous facts

        const dates = Object.keys(logs).sort(); // Get sorted dates with logs for the year

        if (dates.length === 0) {
            listElement.append("<li><i class='fa-solid fa-info-circle'></i> Bu yıl için henüz log kaydı bulunmuyor.</li>");
            return;
        }

        // --- Calculate Statistics ---
        let totalHours = 0;
        let totalEntries = 0;
        let totalWorkDays = 0; // Days with > 0 hours logged
        let maxHoursInDay = 0;
        let maxHoursDate = "";
        let entryTextCounts = {}; // Count occurrences of unique log texts
        let currentStreak = 0;
        let maxStreak = 0;
        let lastLogDate = null;

        dates.forEach(dateString => {
            const dayLogs = logs[dateString] || [];
            const dailyTotalHours = dayLogs.reduce((sum, log) => sum + parseFloat(log.time || 0), 0);

            if (dailyTotalHours > 0) {
                totalHours += dailyTotalHours;
                totalEntries += dayLogs.length;
                totalWorkDays++;

                // Track busiest day
                if (dailyTotalHours > maxHoursInDay) {
                    maxHoursInDay = dailyTotalHours;
                    maxHoursDate = dateString;
                }

                // Count entry texts (ignoring leading emojis for uniqueness)
                dayLogs.forEach(log => {
                    let textKey = (log.text || "").trim().replace(EMOJI_REGEX, "").trim().toLowerCase(); // Normalize text
                    if (textKey) {
                        entryTextCounts[textKey] = (entryTextCounts[textKey] || 0) + 1;
                    }
                });

                // Calculate consecutive day streak
                const currentDate = dayjs(dateString); // Use dayjs for reliable date diff
                if (lastLogDate) {
                    const diffInDays = currentDate.diff(lastLogDate, 'day');
                    if (diffInDays === 1) {
                        currentStreak++; // Consecutive day
                    } else if (diffInDays > 1) {
                        currentStreak = 1; // Streak broken, reset to 1 for current day
                    }
                    // If diffInDays is 0 or less, it means same day or error, streak doesn't change
                } else {
                    currentStreak = 1; // First logged day in the sequence
                }
                maxStreak = Math.max(maxStreak, currentStreak); // Update max streak
                lastLogDate = currentDate; // Update last logged date
            } else {
                 // If a day in the sorted list has 0 hours (shouldn't happen with filter?), reset streak
                 // This logic might be redundant if `dates` only contains days with logs.
                 // However, if filterLogsForYear could include empty days, this is needed.
                 // currentStreak = 0;
            }
        });

        // Find most frequent entry text
        let mostFrequentText = "";
        let maxFrequency = 0;
        for (const text in entryTextCounts) {
            if (entryTextCounts[text] > maxFrequency) {
                maxFrequency = entryTextCounts[text];
                mostFrequentText = text; // Store the normalized text
            }
        }

        // --- Display Fun Facts ---
        if (totalWorkDays > 0) {
            listElement.append(`<li><i class="fa-solid fa-stopwatch"></i> Toplam Efor: <strong>${formatTime(totalHours)} saat</strong></li>`);
            listElement.append(`<li><i class="fa-solid fa-calendar-check"></i> Aktif Gün: <strong>${totalWorkDays} gün</strong></li>`);
            listElement.append(`<li><i class="fa-solid fa-list-ol"></i> Giriş Sayısı: <strong>${totalEntries} adet</strong></li>`);
            listElement.append(`<li><i class="fa-solid fa-clock"></i> Günlük Ortalama: <strong>${formatTime(totalHours / totalWorkDays)} sa/gün</strong></li>`);
        } else {
            listElement.append("<li><i class='fa-solid fa-info-circle'></i> Bu yıl için henüz log kaydı bulunmuyor.</li>"); // Redundant? Already checked at start.
        }

        if (maxHoursDate) {
            listElement.append(`<li><i class="fa-solid fa-fire"></i> En Yoğun Gün: <strong>${maxHoursDate}</strong> (${formatTime(maxHoursInDay)} sa)</li>`);
        }

        if (mostFrequentText && maxFrequency > 1) {
            // Display the original case version if possible? Requires storing original text maybe.
            // For now, display the normalized (lowercase) version.
            const displayText = mostFrequentText.length > 35 ? mostFrequentText.substring(0, 32) + "..." : mostFrequentText;
            listElement.append(`<li><i class="fa-solid fa-repeat"></i> En Sık Girilen: "<strong>${displayText}</strong>" (${maxFrequency} kez)</li>`);
        } else if (totalEntries > 0 && maxFrequency <= 1) {
            listElement.append(`<li><i class="fa-solid fa-repeat"></i> Tekrar eden yaygın bir log girişi yok.</li>`);
        }

        if (totalWorkDays > 0) {
            if (maxStreak > 1) {
                listElement.append(`<li><i class="fa-solid fa-person-running"></i> En Uzun Seri: <strong>${maxStreak} gün</strong></li>`);
            } else {
                 listElement.append(`<li><i class="fa-solid fa-person-running"></i> Çalışma serisi bulunmuyor (1 gün).</li>`);
            }
        }
    }


    function getChartThemeColors(theme) {
        const isLightTheme = theme === "light";
        // Helper to get CSS variable value or fallback
        const getCssVar = (varName, fallbackValue) => {
            const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            return value || fallbackValue;
        };

        // Define colors based on theme, using CSS variables where possible
        return {
            barColor: getCssVar('--primary-color', isLightTheme ? 'rgba(9, 105, 218, 0.7)' : 'rgba(88, 166, 255, 0.7)'), // Use primary color with opacity
            borderColor: getCssVar('--primary-color', isLightTheme ? 'rgba(9, 105, 218, 1)' : 'rgba(88, 166, 255, 1)'), // Solid primary color for border
            gridColor: isLightTheme ? 'rgba(50, 50, 50, 0.1)' : 'rgba(200, 200, 200, 0.1)', // Subtle grid lines
            labelColor: getCssVar('--text-color', isLightTheme ? '#24292f' : '#c9d1d9'), // Use main text color for labels
        };
    }

    function updateChartThemes(theme) {
        console.log("Updating chart themes to:", theme);
        const colors = getChartThemeColors(theme); // Get new colors

        // --- Update Monthly Bar Chart (Chart.js) ---
        if (chartInstances.monthly) {
            try {
                const monthlyChart = chartInstances.monthly;
                // Update dataset colors
                monthlyChart.data.datasets[0].backgroundColor = colors.barColor;
                monthlyChart.data.datasets[0].borderColor = colors.borderColor;
                // Update scale colors
                if (monthlyChart.options.scales.y) {
                    monthlyChart.options.scales.y.grid.color = colors.gridColor;
                    monthlyChart.options.scales.y.ticks.color = colors.labelColor;
                    if (monthlyChart.options.scales.y.title) {
                         monthlyChart.options.scales.y.title.color = colors.labelColor;
                    }
                }
                 if (monthlyChart.options.scales.x) {
                     monthlyChart.options.scales.x.ticks.color = colors.labelColor;
                      if (monthlyChart.options.scales.x.title) {
                         monthlyChart.options.scales.x.title.color = colors.labelColor;
                     }
                 }
                 // Update tooltip colors? (Usually handled by Chart.js defaults based on context)

                monthlyChart.update(); // Apply changes
                console.log("Monthly chart theme updated.");
            } catch (e) {
                 console.error("Error updating monthly chart theme:", e);
            }
        }

        // --- Update Heatmap (CalHeatmap) ---
        // CalHeatmap requires re-painting to change colors effectively.
        if ($("#summary-view").hasClass("active") && chartInstances.heatmap) {
            console.log("Re-rendering heatmap for theme update.");
            // Re-fetch data and re-render (could be optimized if data is cached)
            const logsForYear = filterLogsForYear(allLogs, currentYear);
            renderEffortHeatmap(logsForYear, currentYear); // This will use the new theme colors
        }
    }

    // --- Keyboard Shortcuts ---
    function initializeKeyboardShortcuts() {
        $(document).off("keydown.logpage").on("keydown.logpage", function (e) {
            // --- Determine Context ---
            const activeElement = document.activeElement;
            const isInputFocused = $(activeElement).is("input, textarea, select");
            const isLogModalOpen = logInputOverlay.hasClass("show");
            const isLogTextInputFocused = activeElement.id === "log-text-input";
            const isJiraResultsVisible = jiraSearchResultsContainer.is(":visible");
            const isAIChatOpen = aiChatWindow.is(":visible");
            const isAIChatInputFocused = activeElement.id === "ai-chat-input-field";

            // --- Ignore shortcuts in most input fields (except specific keys) ---
            if (isInputFocused && !isLogTextInputFocused && !isAIChatInputFocused && e.key !== "Escape") {
                return; // Allow default browser behavior for most inputs
            }

            // --- Handle Escape Key ---
            if (e.key === "Escape") {
                e.preventDefault(); // Prevent default escape behavior (like clearing fields)
                if (isJiraResultsVisible && isLogModalOpen) {
                    hideJiraSearchResults(); // Close Jira first
                } else if (isLogModalOpen) {
                    closeLogModal(); // Then close modal
                } else if (isAIChatOpen) {
                    closeAIChatWindow(); // Close AI chat
                }
                return; // Escape handled
            }

            // --- Handle keys within Log Modal Text Input ---
            if (isLogTextInputFocused) {
                // Allow Jira navigation keys if results are visible
                if (isJiraResultsVisible && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter")) {
                    // Let the modal listener handle these
                    return;
                }
                // Allow Enter (with Shift) for newlines
                if (e.key === "Enter" && e.shiftKey) {
                    return; // Allow default newline behavior
                }
                // Allow other standard text input keys (letters, numbers, backspace, etc.)
                // We already handled Enter (without shift) and Escape in the modal listener
                return;
            }

             // --- Handle keys within AI Chat Input ---
             if (isAIChatInputFocused) {
                 // Allow Enter (with Shift) for newlines
                 if (e.key === "Enter" && e.shiftKey) {
                     return; // Allow default newline behavior
                 }
                 // Allow other standard text input keys
                 // Enter (without shift) and Escape are handled by AI chat listener
                 return;
             }


            // --- Global Shortcuts (when not in specific inputs/modals) ---
            if (!isInputFocused && !isLogModalOpen && !isAIChatOpen) {
                switch (e.key.toLowerCase()) {
                    case "n": // New log entry (for today)
                        e.preventDefault();
                        openLogModal(getLocalISODateString(new Date()));
                        break;
                    case "c": // Calendar view
                        e.preventDefault();
                        switchView("calendar-view");
                        break;
                    case "s": // Summary view
                        e.preventDefault();
                        switchView("summary-view");
                        break;
                    case "g": // Settings view (Gear)
                        e.preventDefault();
                        switchView("settings-view");
                        break;
                    case "a": // AI Chat toggle
                        if (userSettings.showAIChat && !!userSettings.aiModel && !!userSettings.aiKey) {
                            e.preventDefault();
                            toggleAIChatWindow();
                        }
                        break;
                    case "t": // Today (scroll in calendar view)
                        if ($("#calendar-view").hasClass("active")) {
                            e.preventDefault();
                            scrollToToday();
                        }
                        break;
                    case "arrowleft": // Previous month (Ctrl + Left)
                        if (e.ctrlKey && $("#calendar-view").hasClass("active")) {
                            e.preventDefault();
                            changeMonth(-1);
                        }
                        break;
                    case "arrowright": // Next month (Ctrl + Right)
                        if (e.ctrlKey && $("#calendar-view").hasClass("active")) {
                            e.preventDefault();
                            changeMonth(1);
                        }
                        break;
                }
            }
        });
    }

    // --- Settings View ---
    function initializeSettingsView() {
        console.log("Initializing Settings View UI from userSettings:", userSettings);

        // --- Populate Color Pickers ---
        $("#settings-color-weekend").val(userSettings.colorPalette["--weekend-bg-color"] || "");
        $("#settings-color-saturday").val(userSettings.colorPalette["--saturday-bg-color"] || "");
        $("#settings-color-holiday").val(userSettings.colorPalette["--holiday-bg-color"] || "");
        $("#settings-color-primary").val(userSettings.colorPalette["--primary-color"] || "");
        // Add other color inputs if they exist

        // --- Populate Jira Settings ---
        $("#settings-jira-url").val(userSettings.jiraUrl || "");
        $("#settings-jira-email").val(userSettings.jiraEmail || "");
        $("#settings-jira-token").val(userSettings.jiraToken || "");

        // --- Populate AI Settings ---
        $("#settings-ai-model").val(userSettings.aiModel || "");
        $("#settings-ai-key").val(userSettings.aiKey || "");
        $("#toggle-ai-chat-button").prop("checked", userSettings.showAIChat || false); // Checkbox/switch state

         // --- Populate Reminder Settings ---
         $("#settings-reminder-enabled").prop("checked", userSettings.reminderEnabled || false);


        // --- Reset UI States ---
        $("#settings-save-status").hide().text(""); // Hide save status message
        $("#import-warning").hide(); // Hide import warning
        $("#import-data-input").val(""); // Clear file input
    }

    function initializeSettingsListeners() {
        console.log("Initializing settings listeners...");
        settingsView.off("input click change"); // Remove previous listeners to avoid duplication

        // --- Color Picker Changes ---
        settingsView.on("input", 'input[type="color"]', function () {
            const cssVar = $(this).data("css-var"); // Get variable name from data attribute
            const colorValue = $(this).val(); // Get selected color

            if (cssVar) {
                // Apply color immediately for preview
                document.documentElement.style.setProperty(cssVar, colorValue);
                // Update settings object (debounced save might be better here)
                userSettings.colorPalette[cssVar] = colorValue;
                // Update charts if summary view is active
                if ($("#summary-view").hasClass("active")) {
                    updateChartThemes(bodyElement.hasClass("light-theme") ? "light" : "dark");
                }
                // Trigger save (consider debouncing or a dedicated save button for colors)
                // saveSettings();
                $("#settings-save-status").text("Kaydedilmedi").css("color", "orange").fadeIn(); // Indicate unsaved changes
            }
        });

         // --- Save Colors Button --- (Assuming a button with this ID exists)
         $("#save-colors-button").on("click", function() {
             saveSettings(); // Explicitly save color changes
         });


        // --- Reset Colors Button ---
        const resetButton = $("#reset-colors-button");
        if (resetButton.length) {
            console.log("Attaching click listener to #reset-colors-button");
            resetButton.on("click", resetColorsToDefaults);
        } else {
            console.error("#reset-colors-button not found in DOM.");
        }

        // --- Save Jira Settings ---
        $("#save-jira-button").on("click", function () {
            userSettings.jiraUrl = $("#settings-jira-url").val().trim();
            userSettings.jiraEmail = $("#settings-jira-email").val().trim();
            userSettings.jiraToken = $("#settings-jira-token").val().trim();
            saveSettings(); // Save immediately
        });

        // --- Save AI Settings ---
        $("#save-ai-button").on("click", function () {
            userSettings.aiModel = $("#settings-ai-model").val().trim();
            userSettings.aiKey = $("#settings-ai-key").val().trim();
            // userSettings.showAIChat is handled by its own toggle
            saveSettings(); // Save immediately
            // Update AI chat button visibility based on new settings
            btnAIChat.toggle(userSettings.showAIChat && !!userSettings.aiModel && !!userSettings.aiKey);
            // Close chat window if AI is now disabled/misconfigured
            if (!userSettings.aiModel || !userSettings.aiKey) closeAIChatWindow();
        });

        // --- Toggle AI Chat Visibility --- (Using 'change' for checkbox/switch)
        $("#toggle-ai-chat-button").on("change", function () {
            userSettings.showAIChat = $(this).is(":checked");
            saveSettings(); // Save immediately
            btnAIChat.toggle(userSettings.showAIChat && !!userSettings.aiModel && !!userSettings.aiKey);
            if (!userSettings.showAIChat) closeAIChatWindow(); // Close window if toggled off
            showToast(userSettings.showAIChat ? "AI Sohbet Butonu Aktif" : "AI Sohbet Butonu Pasif", 1500);
        });

         // --- Toggle Reminder ---
         settingsView.on("change", "#settings-reminder-enabled", function () {
             userSettings.reminderEnabled = $(this).is(":checked");
             saveSettings(); // Save immediately (background script will handle schedule update)
         });


        // --- Export/Import ---
        $("#export-data-button").on("click", exportData);
        $("#import-data-input").on("change", handleFileSelect); // Show warning on file selection
        $("#import-data-button").on("click", importData); // Trigger import process

        console.log("Settings listeners attached.");
    }

    // --- Data Export/Import ---
    function exportData() {
        try {
            // Create a JSON string from the log data
            const dataString = JSON.stringify(allLogs, null, 2); // Pretty print JSON
            const blob = new Blob([dataString], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            // Create a temporary link element to trigger download
            const a = document.createElement("a");
            a.href = url;
            const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format
            a.download = `effortlogger_backup_${date}.json`; // Filename

            // Trigger download and clean up
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url); // Release object URL

            showToast("Log verileri başarıyla dışa aktarıldı.", 2000);
        } catch (e) {
            console.error("Export data error:", e);
            showToast("Verileri dışa aktarırken hata oluştu!", 3000);
        }
    }

    function handleFileSelect(event) {
        // Show warning message when a file is selected
        if (event.target.files && event.target.files.length > 0) {
            $("#import-warning").slideDown(); // Show the warning
        } else {
            $("#import-warning").slideUp(); // Hide if no file selected
        }
    }

    async function importData() {
        const fileInput = document.getElementById("import-data-input");
        if (!fileInput.files || fileInput.files.length === 0) {
            showToast("Lütfen içe aktarılacak bir JSON dosyası seçin.", 2000);
            $("#import-warning").slideUp();
            return;
        }

        const file = fileInput.files[0];

        // Basic file type check
        if (file.type !== "application/json") {
            showToast("Geçersiz dosya tipi. Lütfen '.json' uzantılı bir dosya seçin.", 3000);
            fileInput.value = ""; // Clear the input
            $("#import-warning").slideUp();
            return;
        }

        // --- Confirmation ---
        if (!confirm("UYARI: Bu işlem mevcut tüm log kayıtlarınızı seçeceğiniz dosyadaki verilerle değiştirecektir. Bu işlem geri alınamaz. Devam etmek istediğinizden emin misiniz?")) {
            fileInput.value = ""; // Clear the input
            $("#import-warning").slideUp();
            showToast("İçe aktarma işlemi iptal edildi.", 1500);
            return;
        }

        // --- Read File ---
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);

                // --- Validate Data Structure ---
                // Basic check: should be an object, not null, not an array
                if (typeof importedData !== "object" || importedData === null || Array.isArray(importedData)) {
                    throw new Error("İçe aktarılan JSON dosyasının formatı geçersiz. Kök öğe bir nesne olmalıdır (örn: {'2023-01-01': [...]}).");
                }
                // Optional: More detailed validation (check dates, log entry format) could be added here

                // --- Save Imported Data ---
                await saveLogs(importedData); // Overwrite existing logs

                // --- Update UI ---
                 // Store scroll position *before* re-rendering after import
                 // const scrollPos = calendarView.scrollTop(); // Old way
                await renderCurrentCalendarView(); // Re-render calendar with new data
                 // calendarView.scrollTop(scrollPos); // Old way

                // Optional: Switch to calendar view if not already there
                if (!$('#calendar-view').hasClass('active')) {
                     switchView('calendar-view');
                     // Scroll to today after switching and rendering
                     setTimeout(scrollToToday, 100); // Slight delay for view switch
                } else {
                    // If already on calendar, scroll to today
                    scrollToToday(); // Scroll to today after import
                }


                showToast("Veriler başarıyla içe aktarıldı!", 2000);

            } catch (err) {
                console.error("Import data processing error:", err);
                showToast(`İçe aktarma hatası: ${err.message}`, 5000); // Show detailed error
                 // Optionally reload original logs on error?
                 // await loadLogs();
                 // await renderCurrentCalendarView();
            } finally {
                // --- Cleanup ---
                fileInput.value = ""; // Clear the file input
                $("#import-warning").slideUp(); // Hide warning
            }
        };

        reader.onerror = (e) => {
            console.error("File reading error:", e);
            showToast("Dosya okunurken bir hata oluştu.", 3000);
            fileInput.value = "";
            $("#import-warning").slideUp();
        };

        reader.readAsText(file); // Start reading the file
    }


    // --- AI Chat ---
    function initializeAIChatListeners() {
        // Remove previous listeners first
        btnAIChat.off("click");
        aiChatCloseButton.off("click");
        aiChatSendButton.off("click");
        aiChatInput.off("keydown");

        // Add new listeners
        btnAIChat.on("click", toggleAIChatWindow);
        aiChatCloseButton.on("click", closeAIChatWindow);
        aiChatSendButton.on("click", sendAIChatMessage);
        aiChatInput.on("keydown", function (e) {
            // Send on Enter (but not Shift+Enter)
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault(); // Prevent newline in input
                sendAIChatMessage();
            }
            // Escape key is handled globally by initializeKeyboardShortcuts
        });
    }

    function toggleAIChatWindow() {
        // Check if AI is configured and enabled in settings
        if (!userSettings.showAIChat || !userSettings.aiModel || !userSettings.aiKey) {
            showToast("AI Sohbet özelliği ayarlardan etkinleştirilmedi veya yapılandırılmadı.", 4000);
            // Optionally redirect to settings: switchView('settings-view');
            return;
        }

        // Toggle visibility with animation
        aiChatWindow.slideToggle(300, function () {
            if (aiChatWindow.is(":visible")) {
                aiChatInput.focus(); // Focus input when opened
                // Scroll to the bottom of messages
                aiChatMessages.scrollTop(aiChatMessages[0].scrollHeight);
            }
        });
    }

    function closeAIChatWindow() {
        aiChatWindow.slideUp(300); // Close with animation
    }

    function addChatMessage(sender, message) {
        // sender: 'user' or 'ai'
        const messageElement = $("<div>").addClass(`chat-message ${sender}-message`);

        // Basic Markdown-like formatting (extend as needed)
        // IMPORTANT: Sanitize or use a proper Markdown library if handling complex/untrusted input
        let formattedHtml = message
            .replace(/</g, "&lt;").replace(/>/g, "&gt;") // Basic HTML escaping first
            .replace(/```([\s\S]*?)```/g, (match, code) => `<pre><code>${code.trim()}</code></pre>`) // Code blocks
            .replace(/`([^`]+)`/g, "<code>$1</code>") // Inline code
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // Bold
            .replace(/\*(.*?)\*/g, "<em>$1</em>") // Italics
            .replace(/^- (.*)$/gm, "<li>$1</li>") // List items (basic)
            .replace(/\n/g, "<br>"); // Newlines

        // Wrap list items in <ul> if present
        if (formattedHtml.includes("<li>")) {
            // This simple replace might wrap incorrectly if <li> appears outside a list context
            formattedHtml = `<ul>${formattedHtml.replace(/<br>/g, '')}</ul>`; // Attempt to wrap and remove extra breaks
        }


        messageElement.html(formattedHtml); // Set the formatted HTML
        aiChatMessages.append(messageElement); // Add to the chat container

        // Scroll to the bottom
        aiChatMessages.scrollTop(aiChatMessages[0].scrollHeight);
    }

    async function sendAIChatMessage() {
        const messageText = aiChatInput.val().trim();
        if (!messageText) return; // Don't send empty messages

        addChatMessage("user", messageText); // Display user message immediately
        aiChatInput.val(""); // Clear input field

        // Add placeholder for AI response
        addChatMessage("ai", '<i class="fa-solid fa-spinner fa-spin"></i> Yanıt bekleniyor...'); // Loading indicator

        try {
            const apiKey = userSettings.aiKey;
            const modelId = userSettings.aiModel; // e.g., "google/gemini-pro"

            if (!apiKey || !modelId) {
                throw new Error("AI API Anahtarı veya Model ID ayarlarda eksik.");
            }

            // --- Prepare Context (Recent Logs) ---
            // Get recent log entries (e.g., last 7 days or last 20 entries)
            const recentLogContext = Object.entries(allLogs)
                .sort((a, b) => b[0].localeCompare(a[0])) // Sort by date descending
                .slice(0, 7) // Limit to last 7 days with logs
                .reduce((obj, [date, logs]) => {
                    // Limit entries per day for brevity
                    obj[date] = logs.slice(0, 5).map(log => ({ text: log.text, time: log.time }));
                    return obj;
                }, {});

            // --- Construct Prompt/Messages ---
            // System message providing context and instructions
            const systemPrompt = `Sen EffortLogger uygulamasının bir AI asistanısın. Kullanıcının log kayıtlarına göre sorularını yanıtla. Son log kayıtlarının özeti aşağıdadır. Yanıtlarını Markdown formatında ver. Kısa ve öz ol.
Log Özeti:
\`\`\`json
${JSON.stringify(recentLogContext, null, 2)}
\`\`\``;

            // Prepare request body (adjust based on the specific AI API)
            const requestBody = {
                // Assuming a Gemini-like API structure
                // Adapt 'model' field if needed (e.g., remove prefix)
                model: modelId.includes('/') ? modelId.split('/').pop() : modelId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: messageText }
                ],
                // Add other parameters as needed (temperature, max_tokens, etc.)
                // max_tokens: 800,
                // temperature: 0.7,
            };

            console.log("Sending AI request:", requestBody);

            // --- Call Background Script ---
            const response = await chrome.runtime.sendMessage({
                action: "callAI",
                apiKey: apiKey,
                model: modelId, // Pass the full model identifier if needed by background
                body: requestBody
            });

            // --- Handle Response ---
            const lastAiMessageElement = $("#ai-chat-messages .ai-message:last-child"); // Get the placeholder element

            if (chrome.runtime.lastError) {
                throw new Error(`Mesaj gönderme hatası: ${chrome.runtime.lastError.message}`);
            }

            if (response?.success && response.data?.choices?.[0]?.message?.content) {
                // Success: Update placeholder with actual AI response
                lastAiMessageElement.html(response.data.choices[0].message.content); // Render AI's response (potentially Markdown)
                 // Re-run formatting after content is added
                 addChatMessage('ai', ''); // Add dummy to trigger formatting on the actual last message
                 $('#ai-chat-messages .chat-message').last().remove(); // Remove dummy
                 const actualLast = $('#ai-chat-messages .ai-message').last();
                 actualLast.html(actualLast.html() // Re-apply formatting to the actual response
                     .replace(/```([\s\S]*?)```/g, (match, code) => `<pre><code>${code.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`)
                     .replace(/`([^`]+)`/g, "<code>$1</code>")
                     .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                     .replace(/\*(.*?)\*/g, "<em>$1</em>")
                     .replace(/^- (.*)$/gm, "<li>$1</li>")
                     .replace(/\n/g, "<br>")
                 );
                 if (actualLast.html().includes("<li>")) {
                      actualLast.html(`<ul>${actualLast.html().replace(/<br>/g, '')}</ul>`);
                 }

            } else {
                // Failure or unexpected response format
                const errorMessage = response?.error || "AI'dan geçerli bir yanıt alınamadı.";
                console.error("AI Chat Error:", errorMessage, response);
                lastAiMessageElement.html(`<i class="fa-solid fa-circle-exclamation"></i> Hata: ${errorMessage}`);
            }

        } catch (e) {
            console.error("AI Chat critical error:", e);
            // Update placeholder with critical error message
            $("#ai-chat-messages .ai-message:last-child").html(`<i class="fa-solid fa-circle-exclamation"></i> Kritik Hata: ${e.message}`);
        } finally {
            // Ensure scroll to bottom after response or error
            aiChatMessages.scrollTop(aiChatMessages[0].scrollHeight);
        }
    }

    // --- Scrolling ---
    function scrollToDate(dateString) {
        // Scrolls the calendar view so the specified date's element is centered.
        const $targetElement = $(`.day-item[data-date="${dateString}"]`);
        if ($targetElement.length > 0) {
            console.log(`Scrolling to date: ${dateString}`);
            try {
                $targetElement[0].scrollIntoView({
                    behavior: 'smooth', // Use smooth scrolling
                    block: 'center', // Align vertically to the center
                    inline: 'nearest' // Align horizontally if needed
                });

                // Add temporary highlight effect
                $targetElement.addClass('scroll-highlight');
                setTimeout(() => {
                    $targetElement.removeClass('scroll-highlight');
                }, 1500); // Duration of highlight

                return true; // Indicate success
            } catch (error) {
                 console.error("Error during scrollIntoView:", error);
                 // Fallback: Use jQuery animation (less reliable for centering)
                 // calendarView.animate({ scrollTop: calendarView.scrollTop() + $targetElement.offset().top - calendarView.height() / 2 }, 500);
                 return false;
            }
        } else {
            console.warn(`Element not found for scrolling to date: ${dateString}`);
            return false; // Indicate failure
        }
    }

    function scrollToToday() {
        // Convenience function to scroll to today's date.
        const todayDateString = getLocalISODateString(new Date());
        console.log("Attempting to scroll to today:", todayDateString);
        return scrollToDate(todayDateString);
    }


    // --- Formatting & Helpers ---
    function formatTime(timeValue) {
        // Formats numeric time (e.g., 1.5) into a string (e.g., "1.5", "1")
        const num = parseFloat(timeValue);
        if (isNaN(num) || num === null) return "0"; // Handle invalid input
        if (num === 0) return "0";

        // Use Number.isInteger for whole numbers
        if (Number.isInteger(num)) {
            return num.toString(); // e.g., 1 -> "1"
        }

        // Format decimals, removing trailing zeros where appropriate
        const fixed = num.toFixed(2); // e.g., 1.50, 1.25, 1.00
        if (fixed.endsWith(".00")) {
            return num.toFixed(0); // e.g., 1.00 -> "1"
        }
        if (fixed.endsWith("0")) {
            return num.toFixed(1); // e.g., 1.50 -> "1.5"
        }
        return fixed; // e.g., 1.25 -> "1.25"
    }

    function getDaysInMonth(year, month) {
        // Returns the number of days in a given month (0-indexed) and year.
        // Month is 0-indexed (0=Jan, 11=Dec)
        return new Date(year, month + 1, 0).getDate();
    }

    function getDayNameTR(dayIndex) {
        // Returns the Turkish abbreviation for a day of the week (0=Sun, 6=Sat).
        return DAY_NAMES_TR[dayIndex] || ""; // Fallback to empty string
    }

    function getLocalISODateString(date) {
        // Formats a Date object into "YYYY-MM-DD" string in the local timezone.
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, "0"); // Month is 0-indexed
        const day = date.getDate().toString().padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function showToast(message, duration = 2500) {
        if (isSilentModeActive()) return; // Option to globally disable toasts

        // Use the cached jQuery element
        if (!toastNotification.length) {
            console.warn("Toast notification element (#toast-notification) not found.");
            return;
        }

        // Clear any existing timer to prevent premature hiding
        const existingTimer = toastNotification.data("hideTimer");
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Show the toast
        toastNotification.text(message).addClass("show");

        // Set a timer to hide the toast
        const hideTimer = setTimeout(() => {
            toastNotification.removeClass("show");
            toastNotification.removeData("hideTimer"); // Clean up data attribute
        }, duration);

        // Store the timer ID so it can be cleared if another toast is shown quickly
        toastNotification.data("hideTimer", hideTimer);
    }

    function isSilentModeActive() {
        // Placeholder for potential future silent mode implementation
        return isSilentMode;
    }

    // --- Start the Application ---
    initializeApp();

}); // End of $(document).ready