// --- START OF FILE EfforLogger/js/log.js ---
/**
 * EfforLogger/js/log.js
 *
 * Handles the display, interaction, and data management for the main log viewing page (log.html).
 * Includes calendar rendering, log entry/editing modal, drag & drop, summary view,
 * theme switching, Jira integration placeholders, and user comfort features.
 */

$(document).ready(function() {
    // --- Global Variables & State ---
    let currentYear = new Date().getFullYear();
    let currentMonth = new Date().getMonth(); // 0-11
    let holidays = []; // To store loaded holiday data
    let allLogs = {}; // Cache for loaded logs { 'YYYY-MM-DD': [{text, time, emoji?}, ...] }
    let draggedLogData = null; // Data of the log being dragged
    let draggedLogElement = null; // DOM element being dragged
    let userSettings = { // Store loaded settings
        colorPalette: {}, // Custom colors
        silentMode: false, // Placeholder
        // Add other settings as needed
    };

    // --- DOM Element References ---
    const calendarView = $('#calendar-view');
    const logEntryView = $('#log-entry-view');
    const summaryView = $('#summary-view');
    const logInputOverlay = $('#log-input-overlay');
    const logInputBox = $('.log-input-box');
    const logModalTitle = $('#log-modal-title');
    const logTextInput = $('#log-text-input');
    const logTimeInput = $('#log-time-input');
    const logTargetDateInput = $('#log-target-date');
    const editingLogIndexInput = $('#editing-log-index');
    const saveLogButton = $('#save-log-button');
    const cancelLogButton = $('#cancel-log-button');
    const deleteLogButton = $('#delete-log-button');
    const modalErrorMessage = $('#edit-error-message');
    const toastNotification = $('#toast-notification');
    const themeToggleButton = $('#theme-toggle-button');
    const bodyElement = $('body');
    const modalTimeOptionsContainer = $('#log-input-overlay .time-options-container'); // Modal time options
    const summaryContainer = $('#summary-view'); // Container for summary elements
    const btnSummary = $('#btn-summary'); // Sidebar button for Summary

    // --- Constants ---
    const defaultTimeOptions = [0.25, 0.5, 1, 1.5, 2, 3, 4, 8]; // Default quick time options for modal
    const EMOJI_REGEX = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u;
    const JIRA_REGEX = /([A-Z][A-Z0-9]+-\d+)/g; // Simple Jira Key Regex

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    async function initializeApp() {
        await loadAndApplySettings(); // Load theme, colors, user prefs first
        holidays = await getHolidays();
        switchView('calendar-view'); // Start with calendar view active
        await renderCurrentCalendarView(); // Initial calendar render
        initializeSidebarListeners();
        initializeModalListeners();
        initializeKeyboardShortcuts();
        initializeThemeToggle(); // Separate listener for theme button

        // Log entry view click listener (alternative to sidebar button)
        logEntryView.on('click', () => openLogModal(getLocalISODateString(new Date()))); // Use helper for today's date string

        // Populate time options in the modal
        createModalTimeOptions();
    }

    // =========================================================================
    // SETTINGS & PERSONALIZATION (Theme, Colors, User Prefs)
    // =========================================================================
    async function loadAndApplySettings() {
        // Load user settings from storage (if a settings page exists)
        // For now, we'll mainly focus on theme and colors which are directly used
        try {
            const result = await chrome.storage.local.get(['userSettings']);
            userSettings = { ...userSettings, ...(result.userSettings || {}) };
            // Apply loaded settings (e.g., silent mode might affect animations/toasts)
        } catch (error) {
            console.error("Error loading user settings:", error);
        }
        await loadThemePreference();
        await loadColorSettings();
    }

    // --- Theme Management ---
    function applyTheme(theme) {
        const newTheme = theme || 'dark'; // Default to dark if undefined
        const isLight = newTheme === 'light';

        bodyElement.removeClass('dark-theme light-theme').addClass(isLight ? 'light-theme' : 'dark-theme');

        // Switch CSS file links
        $('#dark-theme-link').prop('disabled', isLight);
        $('#light-theme-link').prop('disabled', !isLight);

        themeToggleButton.html(isLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>')
                         .attr('title', isLight ? 'Koyu Temaya Geç' : 'Açık Temaya Geç');

        // Save the explicit user choice
        chrome.storage.local.set({ preferredTheme: newTheme });
    }


    async function loadThemePreference() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['preferredTheme'], (result) => {
                const savedTheme = result.preferredTheme;
                let themeToApply = savedTheme;

                if (!savedTheme) { // No saved preference, check system
                    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                    themeToApply = prefersDark ? 'dark' : 'light';
                } else {
                    themeToApply = savedTheme;
                }
                applyTheme(themeToApply);
                resolve();
            });
        });
    }

    function initializeThemeToggle() {
        themeToggleButton.on('click', () => {
            const currentTheme = bodyElement.hasClass('light-theme') ? 'light' : 'dark';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            applyTheme(newTheme);
        });

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
            chrome.storage.local.get(['preferredTheme'], (result) => {
                if (!result.preferredTheme) {
                    applyTheme(event.matches ? "dark" : "light");
                }
            });
        });
    }

    // --- Color Palette ---
    async function loadColorSettings() {
        const colorKeys = [
            '--weekend-bg-color', '--saturday-bg-color', '--holiday-bg-color',
            '--today-border-color', '--primary-color'
        ];
        try {
            const result = await chrome.storage.sync.get(colorKeys);
            userSettings.colorPalette = { ...result };
            for (const variable in userSettings.colorPalette) {
                if (userSettings.colorPalette[variable]) {
                    document.documentElement.style.setProperty(variable, userSettings.colorPalette[variable]);
                    // console.log(`Applied custom color: ${variable} = ${userSettings.colorPalette[variable]}`);
                }
            }
        } catch (error) {
             console.error("Error loading color settings:", error);
        }
    }

    // =========================================================================
    // DATA HANDLING (Logs, Holidays)
    // =========================================================================
    async function loadLogs() {
        try {
            const result = await chrome.storage.local.get(['effortLogs']);
            allLogs = result.effortLogs || {};
            return allLogs;
        } catch (error) {
            console.error('Error loading logs:', error);
            showToast("Loglar yüklenirken bir hata oluştu.");
            allLogs = {}; // Reset cache on error
            return {};
        }
    }

    async function saveLogs(logsToSave) {
        try {
            await chrome.storage.local.set({ effortLogs: logsToSave });
            allLogs = logsToSave; // Update cache
        } catch (error) {
            console.error('Error saving logs:', error);
            showToast("Loglar kaydedilirken bir hata oluştu.");
            await loadLogs(); // Reload to ensure consistency after error
        }
    }

     async function getLogsForDate(dateString) {
        if (Object.keys(allLogs).length === 0) {
            await loadLogs();
        }
        return allLogs[dateString] || [];
    }

    async function addLogEntry(date, logEntry) {
        const currentLogs = await loadLogs();
        if (!currentLogs[date]) {
            currentLogs[date] = [];
        }
        currentLogs[date].push(logEntry);
        await saveLogs(currentLogs);
    }

    async function updateLogEntry(date, index, updatedLog) {
        const currentLogs = await loadLogs();
        if (currentLogs[date]?.[index]) {
            currentLogs[date][index] = updatedLog;
            await saveLogs(currentLogs);
        } else {
            console.error("Log entry not found for update:", date, index);
            showToast("Güncellenecek log bulunamadı.");
        }
    }

    async function deleteLogEntry(date, index) {
        const currentLogs = await loadLogs();
        if (currentLogs[date]?.[index]) {
            currentLogs[date].splice(index, 1);
            if (currentLogs[date].length === 0) {
                delete currentLogs[date];
            }
            await saveLogs(currentLogs);
        } else {
            console.error("Log entry not found for deletion:", date, index);
            showToast("Silinecek log bulunamadı.");
        }
    }

    async function clearDayLogs(date) {
         const currentLogs = await loadLogs();
         if (currentLogs[date]) {
             delete currentLogs[date];
             await saveLogs(currentLogs);
             await renderCurrentCalendarView(); // Re-render the view
             showToast(`${date} tarihindeki loglar silindi.`);
         } else {
             showToast("Silinecek log bulunamadı.");
         }
     }

    async function getHolidays() {
        try {
            const holidaysUrl = chrome.runtime.getURL('holidays.json');
            const response = await fetch(holidaysUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("Error fetching holidays:", error);
            showToast("Tatil bilgileri yüklenemedi.");
            return [];
        }
    }

    // =========================================================================
    // VIEW MANAGEMENT & NAVIGATION
    // =========================================================================
    function switchView(targetViewId) {
        $('.view').removeClass('active');
        $('#' + targetViewId).addClass('active');
        $('.sidebar button').removeClass('active');

        if (targetViewId === 'calendar-view') {
            $('#btn-calendar').addClass('active');
        } else if (targetViewId === 'log-entry-view') {
            $('#btn-log-entry').addClass('active');
             openLogModal(getLocalISODateString(new Date()));
        } else if (targetViewId === 'summary-view') {
            $('#btn-summary').addClass('active');
            loadAndRenderSummary();
        }
    }

    function initializeSidebarListeners() {
        $('#btn-calendar').on('click', () => switchView('calendar-view'));
        $('#btn-log-entry').on('click', () => switchView('log-entry-view'));
        btnSummary.on('click', () => switchView('summary-view'));
    }

    // =========================================================================
    // CALENDAR RENDERING
    // =========================================================================
    async function renderCurrentCalendarView() {
        calendarView.empty().append('<p class="loading-text">Takvim yükleniyor...</p>');
        const logs = await loadLogs();
        const monthContainer = renderMonth(currentYear, currentMonth, logs);
        calendarView.empty().append(monthContainer);
        initializeCalendarEventListeners();
        initializeDragAndDrop();
    }

    function renderMonth(year, month, logsForMonth) {
        const monthContainer = $('<div>').addClass('month-container');
        const monthName = new Date(year, month).toLocaleString('tr-TR', { month: 'long' });
        monthContainer.append(`<h3 title="Önceki/Sonraki ay için Ctrl+Ok tuşlarını kullanın">${monthName} ${year}</h3>`);
        const dayList = $('<ul>').addClass('day-list');
        const daysInMonth = getDaysInMonth(year, month);
        const today = new Date(); today.setHours(0, 0, 0, 0);

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day); date.setHours(0, 0, 0, 0);
            const isToday = date.getTime() === today.getTime();
            const dayItem = renderDayItem(date, logsForMonth, holidays, isToday);
            dayList.append(dayItem);
        }
        monthContainer.append(dayList);
        return monthContainer;
    }

    function renderDayItem(date, logsForDay, holidays, isToday) {
        const dayOfMonth = date.getDate();
        const dayOfWeek = date.getDay(); // 0 = Pazar, 6 = Cumartesi

        // ***** FIX: Use local date components for dateString *****
        const dateString = getLocalISODateString(date);
        // ***** END FIX *****

        const dayLogs = logsForDay[dateString] || [];
        const totalTime = dayLogs.reduce((sum, log) => sum + parseFloat(log.time || 0), 0);
        const holidayInfo = holidays.find(h => h.date === dateString);

        const dayItem = $('<li>')
            .addClass('day-item')
            .attr('data-date', dateString)
            .attr('title', `${dateString} için log ekle/düzenle`);

        if (isToday) dayItem.addClass('today');
        if (dayOfWeek === 0) dayItem.addClass('weekend');
        if (dayOfWeek === 6) dayItem.addClass('saturday');
        if (holidayInfo) dayItem.addClass('disabled-day holiday');

        const dayHeader = $('<div>').addClass('day-header');
        const dateInfo = $('<span>').addClass('date-info');
        dateInfo.append($('<span>').addClass('day-number').text(dayOfMonth));
        dateInfo.append($('<span>').addClass('day-name').text(` ${getDayNameTR(dayOfWeek)}`));
        if (holidayInfo) {
            dateInfo.append($('<span>').addClass('holiday-name').text(` (${holidayInfo.name})`).attr('title', holidayInfo.name));
        }

        const dayButtons = $('<div>').addClass('day-buttons');
        if (dayLogs.length > 0 && !holidayInfo) {
            dayButtons.append($('<button>').addClass('copy-to-next-day').attr('title', 'Kayıtları sonraki iş gününe kopyala').html('<i class="fa-regular fa-clone"></i>'));
            dayButtons.append($('<button>').addClass('clear-day-logs').attr('title', 'Günün tüm loglarını sil').html('<i class="fa-solid fa-eraser"></i>'));
        }
        if (dayLogs.length > 0) {
            dayButtons.append($('<button>').addClass('copy-day-logs').attr('title', 'Günün loglarını panoya kopyala').html('<i class="fa-regular fa-copy"></i>'));
        }
        if (dayLogs.length === 0 && !holidayInfo) {
            dayButtons.append($('<button>').addClass('add-log-placeholder').attr('title', 'Bu güne log ekle').html('<i class="fa-solid fa-plus"></i>'));
        }

        dayHeader.append(dateInfo);
        if (totalTime > 0) {
            dayHeader.append($('<span>').addClass('day-total-time').text(`${formatTime(totalTime)}`));
        }
        dayHeader.append(dayButtons);

        const logList = $('<ul>').addClass('log-list');
        if (dayLogs.length > 0) {
            dayLogs.forEach((log, index) => logList.append(renderLogItem(log, index, dateString, !!holidayInfo)));
        } else {
            const noLogsMessage = $('<li>').addClass('no-logs');
            if (holidayInfo) {
                noLogsMessage.text(`${holidayInfo.name}`).addClass('holiday-info');
            } else {
                noLogsMessage.text('Log eklemek için tıklayın').attr('title', 'Bu güne log eklemek için tıklayın');
            }
            logList.append(noLogsMessage);
        }

        dayItem.append(dayHeader).append(logList);
        return dayItem;
    }

    function renderLogItem(log, index, dateString, isHoliday) {
        const logItem = $('<li>')
            .addClass('log-item')
            .attr('data-log-index', index)
            .attr('data-date', dateString)
            .attr('draggable', !isHoliday)
            .attr('title', `${log.text} (${formatTime(log.time)} sa) - Düzenlemek için tıkla, taşımak için sürükle`);

        if (isHoliday) logItem.addClass('disabled-log');

        const logTextSpan = $('<span>').addClass('log-text');
        const logTimeSpan = $('<span>').addClass('log-time').text(formatTime(log.time));
        const textContent = log.text || "";
        const emojiMatch = textContent.trim().match(EMOJI_REGEX);

        if (emojiMatch) {
            const emoji = emojiMatch[1];
            const textWithoutEmoji = textContent.trim().substring(emoji.length).trim();
            logTextSpan.append($('<span>').addClass('log-emoji').text(emoji)).append(document.createTextNode(' ' + textWithoutEmoji));
        } else {
            logTextSpan.text(textContent);
        }

        const jiraMatches = textContent.match(JIRA_REGEX);
        if (jiraMatches) {
            logItem.addClass('has-jira-key');
            logTextSpan.append($('<i>').addClass('fa-brands fa-jira jira-icon').attr('title', `Jira Issue(s): ${jiraMatches.join(', ')}`));
        }

        logItem.append(logTextSpan).append(logTimeSpan);
        return logItem;
    }

    // =========================================================================
    // CALENDAR EVENT LISTENERS
    // =========================================================================
    function initializeCalendarEventListeners() {
        calendarView.off('.logEvents');

        calendarView.on('click.logEvents', '.day-item:not(.disabled-day)', function(e) {
            if ($(e.target).closest('.day-buttons, .log-item').length === 0) {
                openLogModal($(this).data('date'));
            }
        });

        calendarView.on('click.logEvents', '.log-item:not(.disabled-log)', function(event) {
            event.stopPropagation();
            openLogModal($(this).closest('.day-item').data('date'), $(this).data('log-index'));
        });

        calendarView.on('click.logEvents', '.no-logs:not(.holiday-info)', function(event) {
            event.stopPropagation();
            openLogModal($(this).closest('.day-item').data('date'));
        });

        calendarView.on('click.logEvents', '.add-log-placeholder', function(event) {
            event.stopPropagation();
            openLogModal($(this).closest('.day-item').data('date'));
        });

        calendarView.on('click.logEvents', '.copy-day-logs', function(event) {
            event.stopPropagation();
            copyDayLogsToClipboard($(this).closest('.day-item').data('date'), $(this));
        });

        calendarView.on('click.logEvents', '.clear-day-logs', function(event) {
            event.stopPropagation();
            const date = $(this).closest('.day-item').data('date');
            if (confirm(`'${date}' tarihindeki tüm logları silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`)) {
                clearDayLogs(date);
            }
        });

        calendarView.on('click.logEvents', '.copy-to-next-day', async function(event) {
            event.stopPropagation();
            await handleCopyToNextDay($(this));
        });
    }

    // =========================================================================
    // MODAL (LOG ENTRY/EDIT)
    // =========================================================================
     function createModalTimeOptions() {
        modalTimeOptionsContainer.empty();
        defaultTimeOptions.forEach((time) => {
            const optionDiv = $('<div>').addClass('time-option');
            const radioId = `modal-time-${time.toString().replace('.', '-')}`;
            const radioInput = $('<input>').attr({ type: 'radio', id: radioId, name: 'duration-modal', value: time });
            const label = $('<label>').attr('for', radioId).text(`${time} sa`).attr('title', `Süreyi ${time} saat olarak ayarla (Kaydetmek için çift tıkla)`);
            label.on('dblclick', function() { $(this).prev('input[type="radio"]').prop('checked', true); saveLog(); });
            optionDiv.append(radioInput).append(label);
            modalTimeOptionsContainer.append(optionDiv);
        });
    }

    function openLogModal(date, logIndex = -1) {
        logTargetDateInput.val(date);
        editingLogIndexInput.val(logIndex);
        modalErrorMessage.text('');
        logTextInput.val('');
        logTimeInput.val('');
        modalTimeOptionsContainer.find('input[name="duration-modal"]').prop('checked', false);

        if (logIndex > -1) {
            logModalTitle.text(`${date} Log Düzenle`);
            deleteLogButton.show();
            getLogsForDate(date).then(logs => {
                 const log = logs[logIndex];
                 if (log) {
                     logTextInput.val(log.text);
                     logTimeInput.val(log.time);
                     const matchingRadio = modalTimeOptionsContainer.find(`input[value="${log.time}"]`);
                     if (matchingRadio.length > 0) matchingRadio.prop('checked', true);
                 } else {
                      console.error("Cannot find log to edit:", date, logIndex);
                      showToast("Düzenlenecek log verisi bulunamadı.");
                      closeLogModal();
                 }
            });
        } else {
            logModalTitle.text(`${date} Log Ekle`);
            deleteLogButton.hide();
        }

        logInputOverlay.addClass('show');
        setTimeout(() => logTextInput.focus(), 50);
    }

    function closeLogModal() {
        logInputOverlay.removeClass('show');
    }

    async function saveLog() {
        modalErrorMessage.text('');
        const date = logTargetDateInput.val();
        const index = parseInt(editingLogIndexInput.val(), 10);
        let text = logTextInput.val().trim();
        let timeStr = logTimeInput.val().trim().replace(',', '.');
        let time = parseFloat(timeStr);

        const selectedRadio = modalTimeOptionsContainer.find('input[name="duration-modal"]:checked');
        if (selectedRadio.length > 0) {
            time = parseFloat(selectedRadio.val());
            logTimeInput.val(time);
        }

        if (!text) return modalErrorMessage.text('Lütfen bir açıklama girin.'), logTextInput.focus();
        if (isNaN(time) || time <= 0) return modalErrorMessage.text('Lütfen geçerli bir pozitif süre girin veya seçin.'), logTimeInput.focus();
        if (!date) return modalErrorMessage.text('Hedef tarih belirlenemedi.');

        const logEntry = { text: text, time: time };

        try {
            if (index > -1) {
                await updateLogEntry(date, index, logEntry);
                showToast("Log güncellendi.");
            } else {
                await addLogEntry(date, logEntry);
                showToast("Log eklendi.");
            }
            closeLogModal();
            await renderCurrentCalendarView();

            saveLogButton.addClass('saved-animation');
            setTimeout(() => saveLogButton.removeClass('saved-animation'), 600);

        } catch (error) {
            console.error("Error saving log via modal:", error);
            modalErrorMessage.text("Kaydetme sırasında bir hata oluştu.");
        }
    }

    async function deleteLog() {
        const date = logTargetDateInput.val();
        const index = parseInt(editingLogIndexInput.val(), 10);

        if (index > -1 && date) {
            if (confirm("Bu log girişini silmek istediğinizden emin misiniz?")) {
                try {
                    await deleteLogEntry(date, index);
                    showToast("Log silindi.");
                    closeLogModal();
                    await renderCurrentCalendarView();
                } catch (error) {
                     console.error("Error deleting log via modal:", error);
                     modalErrorMessage.text("Silme sırasında bir hata oluştu.");
                }
            }
        } else {
             modalErrorMessage.text("Silinecek log belirlenemedi.");
        }
    }

    function initializeModalListeners() {
        saveLogButton.on('click', saveLog);
        cancelLogButton.on('click', closeLogModal);
        deleteLogButton.on('click', deleteLog);

        logInputOverlay.on('click', function(event) {
            if (event.target === this) closeLogModal();
        });

         logTextInput.on('keydown', function(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                 event.preventDefault();
                 logTimeInput.focus();
             }
         });

         logTimeInput.on('keydown', function(event) {
            if (event.key === 'Enter') {
                 event.preventDefault();
                 saveLog();
             }
         });

         modalTimeOptionsContainer.on('keydown', 'input[type="radio"]', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault(); saveLog();
            } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                 event.preventDefault();
                 $(this).closest('.time-option').next('.time-option').find('input[type="radio"]').focus().prop('checked', true);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                 event.preventDefault();
                 $(this).closest('.time-option').prev('.time-option').find('input[type="radio"]').focus().prop('checked', true);
            }
         });
    }

    // =========================================================================
    // DRAG AND DROP
    // =========================================================================
    function initializeDragAndDrop() {
        calendarView.off('.logDnD');

        calendarView.on('dragstart.logDnD', '.log-item:not(.disabled-log)', function(event) {
            draggedLogElement = this;
            const logIndex = $(this).data('log-index');
            const date = $(this).data('date');
             if (!allLogs[date]?.[logIndex]) {
                 console.error("Cannot start drag: Log data not found for", date, logIndex);
                 event.preventDefault(); return;
             }
            draggedLogData = { ...allLogs[date][logIndex], originalDate: date, originalIndex: logIndex };
            event.originalEvent.dataTransfer.effectAllowed = 'move';
            event.originalEvent.dataTransfer.setData('text/plain', draggedLogData.text);
            $(this).addClass('dragging');
            $('body').addClass('dragging-log');
        });

        calendarView.on('dragover.logDnD', '.day-item:not(.disabled-day)', function(event) {
            event.preventDefault();
            event.originalEvent.dataTransfer.dropEffect = 'move';
            $(this).addClass('drag-over');
        });

        calendarView.on('dragleave.logDnD', '.day-item', function(event) {
             if (!$(this).is(event.relatedTarget) && !$.contains(this, event.relatedTarget)) {
                $(this).removeClass('drag-over');
            }
        });

        calendarView.on('drop.logDnD', '.day-item:not(.disabled-day)', async function(event) {
            event.preventDefault(); event.stopPropagation();
            $(this).removeClass('drag-over');
            const targetDate = $(this).data('date');
            if (!draggedLogData || !draggedLogElement || !targetDate) return resetDragState();

            const sourceDate = draggedLogData.originalDate;
            const sourceIndex = draggedLogData.originalIndex;
            if (sourceDate === targetDate) return resetDragState(); // No reorder yet

            const logToMove = { text: draggedLogData.text, time: draggedLogData.time };

            try {
                const currentLogs = await loadLogs();
                if (!currentLogs[sourceDate]?.[sourceIndex]) throw new Error("Source log missing.");
                currentLogs[sourceDate].splice(sourceIndex, 1);
                if (currentLogs[sourceDate].length === 0) delete currentLogs[sourceDate];
                if (!currentLogs[targetDate]) currentLogs[targetDate] = [];
                currentLogs[targetDate].push(logToMove);
                await saveLogs(currentLogs);
                await renderCurrentCalendarView();
                showToast(`Log "${logToMove.text.substring(0, 15)}..." ${targetDate} tarihine taşındı.`);
            } catch (error) {
                console.error("Error moving log:", error);
                showToast("Log taşınırken bir hata oluştu.");
                await renderCurrentCalendarView();
            } finally {
                 resetDragState();
            }
        });

        calendarView.on('dragend.logDnD', '.log-item', resetDragState);
    }

    function resetDragState() {
        if (draggedLogElement) $(draggedLogElement).removeClass('dragging');
        $('.day-item').removeClass('drag-over');
        $('body').removeClass('dragging-log');
        draggedLogData = null;
        draggedLogElement = null;
    }

    // =========================================================================
    // ACTIONS (Copy to Clipboard, Copy to Next Day)
    // =========================================================================
    async function copyDayLogsToClipboard(date, buttonElement) {
        const logs = await getLogsForDate(date);
        if (!logs || logs.length === 0) return showToast("Kopyalanacak log bulunamadı.");

        const formattedLogs = logs.map(log => `- ${log.text} (${formatTime(log.time)} sa)`).join('\n');
        const totalTime = logs.reduce((sum, l) => sum + parseFloat(l.time || 0), 0);
        const clipboardText = `${date} Eforları:\n${formattedLogs}\nToplam: ${formatTime(totalTime)} sa`;

        try {
            await navigator.clipboard.writeText(clipboardText);
            showToast("Loglar panoya kopyalandı!");
            buttonElement.html('<i class="fa-solid fa-check"></i>').addClass('copied');
            setTimeout(() => buttonElement.html('<i class="fa-regular fa-copy"></i>').removeClass('copied'), 1500);
        } catch (err) {
            console.error('Failed to copy logs:', err); showToast("Panoya kopyalanamadı.");
        }
    }

    async function handleCopyToNextDay(buttonElement) {
        const sourceDateStr = buttonElement.closest('.day-item').data('date');
        let nextDate = new Date(sourceDateStr);
        let attempts = 0; const maxAttempts = 14;

        do {
            nextDate.setDate(nextDate.getDate() + 1); attempts++;
            const nextDateStr = getLocalISODateString(nextDate); // Use helper here too
            const dayOfWeek = nextDate.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isHoliday = holidays.some(h => h.date === nextDateStr);
            if (!isWeekend && !isHoliday) {
                await performCopy(sourceDateStr, nextDateStr, buttonElement);
                return;
            }
        } while (attempts < maxAttempts);
        showToast(`Sonraki iş günü bulunamadı (${maxAttempts} gün denendi).`);
    }

    async function performCopy(sourceDateStr, nextDateStr, buttonElement) {
        const sourceLogs = await getLogsForDate(sourceDateStr);
        if (!sourceLogs || sourceLogs.length === 0) return showToast("Kopyalanacak log bulunamadı.");
        if (!confirm(`'${sourceDateStr}' loglarını bir sonraki iş günü olan '${nextDateStr}' tarihine kopyala?`)) return;

        try {
            const currentLogs = await loadLogs();
            if (!currentLogs[nextDateStr]) currentLogs[nextDateStr] = [];
            const logsToCopy = sourceLogs.map(log => ({ text: log.text, time: log.time }));
            currentLogs[nextDateStr].push(...logsToCopy);
            await saveLogs(currentLogs);
            await renderCurrentCalendarView();
            showToast(`${sourceDateStr} logları ${nextDateStr} tarihine kopyalandı.`);
            buttonElement.html('<i class="fa-solid fa-check"></i>').addClass('copied');
            setTimeout(() => buttonElement.html('<i class="fa-regular fa-clone"></i>').removeClass('copied'), 1500);
        } catch (error) {
            console.error("Error copying logs:", error);
            showToast("Loglar kopyalanırken bir hata oluştu.");
            await renderCurrentCalendarView();
        }
    }

    // =========================================================================
    // SUMMARY VIEW
    // =========================================================================
    async function loadAndRenderSummary() {
        summaryContainer.empty().append('<p class="loading-text">Özet verileri yükleniyor...</p>');
        try {
            const allLogsData = await loadLogs();
            const yearToDisplay = currentYear;
            const logsForYear = filterLogsForYear(allLogsData, yearToDisplay);

            summaryContainer.html(`
                <h2>${yearToDisplay} Yılı Özeti</h2>
                <div class="summary-grid">
                    <div id="cal-heatmap" class="summary-widget"><h3>Efor Yoğunluğu</h3><p>Yükleniyor...</p></div>
                    <div id="hourglass-chart" class="summary-widget"><h3>Aylık Dağılım</h3><p>Yükleniyor...</p></div>
                    <div id="fun-facts" class="summary-widget"><h3>İlginç Gerçekler</h3><ul id="fun-facts-list"><li>Hesaplanıyor...</li></ul></div>
                </div>`);

            renderEffortHeatmap(logsForYear, yearToDisplay);
            renderHourglassChart(logsForYear);
            renderFunFacts(logsForYear);

        } catch (error) {
            console.error("Error loading summary data:", error);
            summaryContainer.html('<p class="error">Özet verileri yüklenirken bir hata oluştu.</p>');
        }
    }

    function filterLogsForYear(allLogsData, year) {
        return Object.entries(allLogsData)
            .filter(([date]) => date.startsWith(year.toString()))
            .reduce((obj, [date, logs]) => { obj[date] = logs; return obj; }, {});
    }

    function renderEffortHeatmap(logs, year) { /* Placeholder */
        $('#cal-heatmap').find('p').remove().end().append('<div id="cal-heatmap-graph"><p style="color: var(--text-secondary-color); font-size: 0.9em;">Yoğunluk Haritası (Cal-Heatmap kütüphanesi gerekli)</p></div>');
    }
    function renderHourglassChart(logs) { /* Placeholder */
         $('#hourglass-chart').find('p').remove().end().append('<canvas id="hourglassCanvas"></canvas>').find('#hourglassCanvas').replaceWith('<p style="color: var(--text-secondary-color); font-size: 0.9em;">Aylık Grafik (Chart.js kütüphanesi gerekli)</p>');
    }
    function renderFunFacts(logs) { /* Calculation logic remains the same */
        const factsList = $('#fun-facts-list'); factsList.empty();
        if (Object.keys(logs).length === 0) { factsList.append('<li>Bu yıl için hiç kayıt bulunamadı.</li>'); return; }
        let maxHoursDay = 0, maxHoursDate = '', totalHours = 0, totalLogEntries = 0, workDays = 0;
        let descriptionCounts = {}, consecutiveDays = 0, maxConsecutiveDays = 0, lastLogDate = null;
        const sortedDates = Object.keys(logs).sort();
        sortedDates.forEach(date => {
            const dailyTotal = logs[date].reduce((sum, log) => sum + parseFloat(log.time || 0), 0);
            if (dailyTotal > 0) {
                totalHours += dailyTotal; totalLogEntries += logs[date].length; workDays++;
                if (dailyTotal > maxHoursDay) { maxHoursDay = dailyTotal; maxHoursDate = date; }
                logs[date].forEach(log => { let desc = log.text.trim().replace(EMOJI_REGEX, '').trim(); descriptionCounts[desc] = (descriptionCounts[desc] || 0) + 1; });
                const currentDate = new Date(date);
                if (lastLogDate) { const diffDays = Math.round((currentDate - lastLogDate) / (1000 * 60 * 60 * 24)); consecutiveDays = (diffDays === 1) ? consecutiveDays + 1 : 1; }
                else { consecutiveDays = 1; }
                maxConsecutiveDays = Math.max(maxConsecutiveDays, consecutiveDays); lastLogDate = currentDate;
            } else { consecutiveDays = 0; }
        });
        maxConsecutiveDays = Math.max(maxConsecutiveDays, consecutiveDays);
        let mostFrequentDesc = '', maxFreq = 0;
        for (const desc in descriptionCounts) { if (descriptionCounts[desc] > maxFreq) { maxFreq = descriptionCounts[desc]; mostFrequentDesc = desc; } }
        if(totalHours > 0) factsList.append(`<li>📊 Toplam <strong>${formatTime(totalHours)} sa</strong> (${workDays} gün, ${totalLogEntries} giriş).</li>`);
        if (maxHoursDate) factsList.append(`<li>🔥 En yoğun gün: <strong>${maxHoursDate}</strong> (${formatTime(maxHoursDay)} sa).</li>`);
        if (mostFrequentDesc && maxFreq > 1) factsList.append(`<li>🔁 En sık: "<strong>${mostFrequentDesc.substring(0,30)}${mostFrequentDesc.length > 30 ? '...' : ''}</strong>" (${maxFreq} kez).</li>`);
        if (maxConsecutiveDays > 1) factsList.append(`<li>🏃 Seri: <strong>${maxConsecutiveDays} gün</strong>.</li>`);
        else if (workDays > 0) factsList.append(`<li>🏃 Seri: 1 gün.</li>`);
        if (workDays > 0) factsList.append(`<li>⏱️ Ortalama: <strong>${formatTime(totalHours / workDays)} sa/gün</strong>.</li>`);
    }

    // =========================================================================
    // KEYBOARD SHORTCUTS
    // =========================================================================
    function initializeKeyboardShortcuts() {
        $(document).off('keydown.logpage').on('keydown.logpage', function(event) {
            if (event.key === 'Escape' && logInputOverlay.hasClass('show')) { closeLogModal(); return; }
            if ($(event.target).is('input, textarea, select') || logInputOverlay.hasClass('show')) return;
            if (event.key === 'n' || event.key === 'N') { event.preventDefault(); openLogModal(getLocalISODateString(new Date())); }
            if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); changeMonth(event.key === 'ArrowLeft' ? -1 : 1); }
        });
    }

    // =========================================================================
    // MONTH NAVIGATION
    // =========================================================================
    async function changeMonth(direction) {
        currentMonth += direction;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        await renderCurrentCalendarView();
        showToast(`${new Date(currentYear, currentMonth).toLocaleString('tr-TR', { month: 'long' })} ${currentYear} gösteriliyor.`);
    }

    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================
    function formatTime(timeInHours) {
        if (isNaN(timeInHours) || timeInHours === null || timeInHours === 0) return '0';
        const formatted = parseFloat(timeInHours).toFixed(2);
        return formatted.endsWith('.00') ? parseInt(formatted).toString() : formatted.endsWith('0') ? formatted.slice(0, -1) : formatted;
    }

    function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
    function getDayNameTR(dayOfWeek) { const days = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']; return days[dayOfWeek]; }
    function getNextDayDate(dateString) { const date = new Date(dateString); date.setDate(date.getDate() + 1); return getLocalISODateString(date); } // Use helper

    // ***** NEW HELPER FUNCTION *****
    function getLocalISODateString(date) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-indexed
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    // ***** END HELPER FUNCTION *****

    function showToast(message, duration = 2500) {
        if (isSilentModeActive()) return;
        toastNotification.text(message).addClass('show');
        if (toastNotification.data('hideTimer')) clearTimeout(toastNotification.data('hideTimer'));
        const timer = setTimeout(() => { toastNotification.removeClass('show').removeData('hideTimer'); }, duration);
        toastNotification.data('hideTimer', timer);
    }

    function isSilentModeActive() { return false; /* Placeholder */ }

    // =========================================================================
    // START THE APPLICATION
    // =========================================================================
    initializeApp();

}); // End of $(document).ready