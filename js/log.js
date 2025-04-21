$(document).ready(function () {
    // --- Element Referansları ---
    const calendarView = $("#calendar-view");
    const logEntryView = $("#log-entry-view");
    const logInputOverlay = $("#log-input-overlay");
    const logTextInput = $("#log-text-input");
    const logTimeInput = $("#log-time-input");
    const timeOptionsContainer = $(".time-options-container");
    const logTargetDateInput = $("#log-target-date");
    const editingLogIndexInput = $("#editing-log-index");
    const saveLogButton = $("#save-log-button");
    const cancelLogButton = $("#cancel-log-button");
    const deleteLogButton = $("#delete-log-button");
    const logModalTitle = $("#log-modal-title");
    const toastNotification = $("#toast-notification");
    const editErrorMessage = $("#edit-error-message");
    const body = $("body");

    const btnCalendar = $("#btn-calendar");
    const btnLogEntry = $("#btn-log-entry");

    // --- Sabitler ve Değişkenler ---
    let allData = {};
    let holidays = [];
    const MAX_DAILY_HOURS = 24.0;
    const commonDurations = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 4.0];
    let dragData = null; // { sourceDate, logIndex, logData, element }
    let dropIndicator = null; // Görsel işaretçi elementi için referans

    // --- Helper Fonksiyonlar ---
    function getFormattedDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function getMonthName(monthIndex) {
        const monthNames = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
        return monthNames[monthIndex];
    }

    function getDayName(dayIndex) {
        const dayNamesSafe = ["Pzr", "Pzt", "Sal", "Çrş", "Prş", "Cum", "Cmt"];
        return dayNamesSafe[dayIndex];
    }

    function showToast(message) {
        toastNotification.text(message);
        toastNotification.addClass("show");
        setTimeout(() => {
            toastNotification.removeClass("show");
        }, 2500);
    }

    // --- Veri Yönetimi ---
    async function loadData() {
        try {
            const result = await chrome.storage.local.get(['effortLogData']);
            allData = result.effortLogData || {};
        } catch (error) {
            console.error("Veri yüklenirken hata:", error);
            allData = {};
            showToast("Log verileri yüklenemedi!");
        }
    }

    async function loadHolidays() {
        try {
            const response = await fetch(chrome.runtime.getURL('holidays.json'));
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const holidayData = await response.json();
            holidays = holidayData || [];
        } catch (error) {
            console.error("Tatil verisi yüklenirken hata:", error);
            holidays = [];
            showToast("Tatil bilgileri yüklenemedi.");
        }
    }

    async function saveDataToStorage(dataToSave) {
        try {
            await chrome.storage.local.set({ effortLogData: dataToSave });
        } catch (error) {
            console.error("Veri kaydedilirken hata:", error);
            showToast("Veri kaydedilirken bir hata oluştu!");
        }
    }

    // --- Log İşlemleri ---
    async function getLogs(dateString) {
        return allData[dateString] || [];
    }

    async function saveLog(dateString, logText, logTime) {
        const timeValue = parseFloat(logTime);
        if (isNaN(timeValue) || timeValue <= 0) {
            editErrorMessage.text("Geçerli bir saat girin (örn: 0.5).");
            logTimeInput.focus();
            return false;
        }
        if (!logText) {
            editErrorMessage.text("Açıklama boş olamaz.");
            logTextInput.focus();
            return false;
        }

        const logs = await getLogs(dateString);
        let currentTotalDuration = logs.reduce((sum, log) => sum + (parseFloat(log.time) || 0), 0);
        if (currentTotalDuration + timeValue > MAX_DAILY_HOURS) {
            const remaining = (MAX_DAILY_HOURS - currentTotalDuration).toFixed(2);
            editErrorMessage.text(`Günlük ${MAX_DAILY_HOURS} saat limiti aşılamaz. Kalan: ${remaining} saat.`);
            return false;
        }

        const newLog = { text: logText, time: timeValue.toFixed(2) };
        logs.push(newLog);
        allData[dateString] = logs;
        await saveDataToStorage(allData);
        return true;
    }

    async function updateLog(dateString, logIndex, newLogText, newLogTime) {
        const timeValue = parseFloat(newLogTime);
        if (isNaN(timeValue) || timeValue <= 0) {
            editErrorMessage.text("Geçerli bir saat girin (örn: 0.5).");
            logTimeInput.focus();
            return false;
        }
        if (!newLogText) {
            editErrorMessage.text("Açıklama boş olamaz.");
            logTextInput.focus();
            return false;
        }

        const logs = await getLogs(dateString);
        if (logIndex >= 0 && logIndex < logs.length) {
            let currentTotalDuration = 0;
            logs.forEach((log, index) => {
                if (index !== logIndex) {
                    currentTotalDuration += parseFloat(log.time || 0);
                }
            });

            if (currentTotalDuration + timeValue > MAX_DAILY_HOURS) {
                const remaining = (MAX_DAILY_HOURS - currentTotalDuration).toFixed(2);
                editErrorMessage.text(`Günlük ${MAX_DAILY_HOURS} saat limiti aşılamaz. Kalan: ${remaining} saat.`);
                return false;
            }

            logs[logIndex] = { text: newLogText, time: timeValue.toFixed(2) };
            allData[dateString] = logs;
            await saveDataToStorage(allData);
            return true;
        } else {
            console.error(`Invalid log index ${logIndex} for date ${dateString}`);
            editErrorMessage.text("Log güncellenirken bir hata oluştu (geçersiz index).");
            return false;
        }
    }

    async function deleteLog(dateString, logIndex) {
        const logs = await getLogs(dateString);
        if (logIndex >= 0 && logIndex < logs.length) {
            logs.splice(logIndex, 1);
            if (logs.length === 0) {
                delete allData[dateString];
            } else {
                allData[dateString] = logs;
            }
            await saveDataToStorage(allData);
            return true;
        } else {
            console.error(`Invalid log index ${logIndex} for deletion on date ${dateString}`);
            editErrorMessage.text("Log silinirken bir hata oluştu (geçersiz index).");
            return false;
        }
    }

    async function clearLogs(dateString) {
        if (allData[dateString]) {
            delete allData[dateString];
            await saveDataToStorage(allData);
            return true;
        }
        return false;
    }

    // --- UI Rendering ---
    async function renderMonthCalendar(targetDate, container) {
        container.empty();
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();

        container.append(`<h3>${getMonthName(month)} ${year}</h3>`);
        const $dayList = $('<ul class="day-list"></ul>');
        container.append($dayList);

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayFormatted = getFormattedDate(new Date());

        for (let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(year, month, day);
            const dateString = getFormattedDate(currentDate);
            const dayLogs = allData[dateString] || [];
            const dayOfWeek = currentDate.getDay();

            const $dayItem = $(`<li class="day-item" data-date="${dateString}"></li>`);
            let isHoliday = false;
            let holidayInfo = null;
            let totalHours = 0;

            holidayInfo = holidays.find(h => h.date === dateString);
            if (holidayInfo) {
                isHoliday = true;
                $dayItem.addClass("disabled-day holiday");
                $dayItem.attr("title", holidayInfo.name);
            } else {
                 // Hem günün kendisi hem de log listesi drop hedefi olabilir
                 $dayItem.attr("data-droppable", "true");
            }

            if (!isHoliday && dateString === todayFormatted) {
                $dayItem.addClass("today");
            }

            if (!isHoliday) {
                totalHours = dayLogs.reduce((sum, log) => sum + (parseFloat(log.time) || 0), 0);
            }
            const formattedTotalHours = parseFloat(totalHours.toFixed(2)).toString();

            const $dayHeader = $(`
                <div class="day-header">
                    <span class="date-info">
                        ${day} ${getMonthName(month)}
                        <span class="day-name">(${getDayName(dayOfWeek)})</span>
                        ${isHoliday ? `<span class="holiday-name"> - ${holidayInfo.name}</span>` : ""}
                    </span>
                    ${!isHoliday && totalHours >= 0 ? `<span class="day-total-time">${formattedTotalHours}</span>` : ""}
                    <div class="day-buttons">
                         ${!isHoliday && dayLogs.length > 0 ? `
                            <button class="copy-day-logs" title="Logları Kopyala"><i class="fa-regular fa-copy"></i></button>
                            <button class="clear-day-logs" title="Günün Loglarını Sil"><i class="fa-regular fa-trash-can"></i></button>
                         ` : !isHoliday ? `
                            <button class="add-log-placeholder" title="Log Ekle"><i class="fa-solid fa-plus" style="font-size: 0.8em; opacity: 0.5;"></i></button>
                         `: ''}
                    </div>
                </div>`);
            $dayItem.append($dayHeader);

            // Log listesine de droppable özelliği ekleyelim (sıralama için)
            const $logListUl = $('<ul class="log-list" data-droppable-list="true"></ul>');
            if (!isHoliday && dayLogs.length > 0) {
                dayLogs.forEach((log, index) => {
                     const logTimeFormatted = parseFloat(log.time || 0).toFixed(2);
                    $logListUl.append(`
                        <li class="log-item"
                            data-log-index="${index}"
                            data-source-date="${dateString}"
                            draggable="true">
                            <span class="log-text">${log.text || "Açıklama yok"}</span>
                            <span class="log-time">${logTimeFormatted}</span>
                        </li>
                    `);
                });
            } else if (!isHoliday) {
                $logListUl.append('<li class="no-logs">Log eklemek için tıklayın</li>');
            } else {
                $logListUl.append('<li class="no-logs holiday-info">Resmi Tatil</li>');
            }
            $dayItem.append($logListUl);

            $dayList.append($dayItem);
        }
    }

     async function renderDayLogList(dateString) {
        const $dayItem = calendarView.find(`.day-item[data-date="${dateString}"]`);
        if (!$dayItem.length || $dayItem.hasClass('disabled-day')) return;

        const $logListUl = $dayItem.find(".log-list");
        $logListUl.empty(); // Mevcut listeyi temizle

        const dayLogs = allData[dateString] || [];
        const totalHours = dayLogs.reduce((sum, log) => sum + (parseFloat(log.time) || 0), 0);
        const formattedTotalHours = parseFloat(totalHours.toFixed(2)).toString();

        // Header'daki toplam saati güncelle
        $dayItem.find(".day-total-time").text(formattedTotalHours);
        // Header'daki butonları güncelle (log varsa copy/clear, yoksa add)
        const $dayButtons = $dayItem.find(".day-buttons");
        $dayButtons.empty();
        if (dayLogs.length > 0) {
            $dayButtons.append(`
                <button class="copy-day-logs" title="Logları Kopyala"><i class="fa-regular fa-copy"></i></button>
                <button class="clear-day-logs" title="Günün Loglarını Sil"><i class="fa-regular fa-trash-can"></i></button>
            `);
        } else {
             $dayButtons.append(`
                <button class="add-log-placeholder" title="Log Ekle"><i class="fa-solid fa-plus" style="font-size: 0.8em; opacity: 0.5;"></i></button>
             `);
        }


        if (dayLogs.length > 0) {
            dayLogs.forEach((log, index) => {
                const logTimeFormatted = parseFloat(log.time || 0).toFixed(2);
                $logListUl.append(`
                    <li class="log-item"
                        data-log-index="${index}"
                        data-source-date="${dateString}"
                        draggable="true">
                        <span class="log-text">${log.text || "Açıklama yok"}</span>
                        <span class="log-time">${logTimeFormatted}</span>
                    </li>
                `);
            });
        } else {
            $logListUl.append('<li class="no-logs">Log eklemek için tıklayın</li>');
        }
    }


    async function renderFullCalendar() {
        await loadData();
        await loadHolidays();
        calendarView.empty();

        const today = new Date();
        const currentMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);

        const $prevMonthContainer = $('<div class="month-container" id="month-prev"></div>');
        const $currentMonthContainer = $('<div class="month-container" id="month-current"></div>');
        calendarView.append($prevMonthContainer).append($currentMonthContainer);

        await renderMonthCalendar(prevMonthDate, $prevMonthContainer);
        await renderMonthCalendar(currentMonthDate, $currentMonthContainer);

        removeDropIndicator(); // Kalan işaretçileri temizle
        calendarView.find(".day-item.drag-over").removeClass("drag-over");

        setTimeout(() => {
            const todayElement = calendarView.find(".day-item.today");
            if (todayElement.length > 0) {
                const dayListContainer = todayElement.closest(".day-list");
                if (dayListContainer.length > 0) {
                    try {
                        todayElement[0].scrollIntoView({ block: "center", behavior: "smooth" });
                    } catch(e){
                        console.warn("Scroll into view failed:", e);
                        const containerTop = dayListContainer.offset().top;
                        const elementTop = todayElement.offset().top;
                        const containerScrollTop = dayListContainer.scrollTop();
                        dayListContainer.scrollTop(containerScrollTop + elementTop - containerTop - (dayListContainer.height() / 2) + (todayElement.height() / 2));
                    }
                }
            }
        }, 150);
    }

    // --- Zaman Seçenekleri ---
    function populateTimeOptions() {
        timeOptionsContainer.empty();
        commonDurations.forEach(duration => {
            const value = duration.toFixed(2);
            const displayValue = parseFloat(value).toString();
            const radioId = `time-option-${displayValue.replace(".", "-")}`;
            const radioHtml = `
             <div class="time-option">
                 <input type="radio" name="time-select" id="${radioId}" value="${displayValue}">
                 <label for="${radioId}">${displayValue} h</label>
             </div>`;
            timeOptionsContainer.append(radioHtml);
        });
    }

    // --- Log Giriş Overlay ---
    function showLogInputOverlay(targetDateString, editData = null) {
        logTargetDateInput.val(targetDateString);
        editErrorMessage.text('');
        populateTimeOptions();

        if (editData) {
            const displayDate = new Date(targetDateString);
            logModalTitle.text(`${displayDate.getDate()} ${getMonthName(displayDate.getMonth())} ${displayDate.getFullYear()} - Log Düzenle`);
            logTextInput.val(editData.text);
            logTimeInput.val(editData.time);
            editingLogIndexInput.val(editData.index);
            deleteLogButton.show();
            logTimeInput.trigger('input');
        } else {
            const displayDate = new Date(targetDateString);
            logModalTitle.text(`${displayDate.getDate()} ${getMonthName(displayDate.getMonth())} ${displayDate.getFullYear()} için Yeni Log Ekle`);
            logTextInput.val("");
            logTimeInput.val("");
            editingLogIndexInput.val("-1");
            deleteLogButton.hide();
            timeOptionsContainer.find('input[type="radio"]').prop('checked', false);
        }
        logInputOverlay.addClass('show');
        logTextInput.focus();
    }

    function hideLogInputOverlay() {
        logInputOverlay.removeClass('show');
        logTextInput.val('');
        logTimeInput.val('');
        logTargetDateInput.val('');
        editingLogIndexInput.val('-1');
        timeOptionsContainer.find('input[type="radio"]').prop('checked', false);
        editErrorMessage.text('');
    }

    // --- Olay Dinleyicileri ---

    // Sidebar Buton Tıklamaları
    btnCalendar.on("click", function () {
        if ($(this).hasClass("active")) return;
        $(".sidebar button").removeClass("active");
        $(this).addClass("active");
        logEntryView.removeClass("active");
        calendarView.addClass("active");
        renderFullCalendar();
    });

    btnLogEntry.on("click", function () {
        if ($(this).hasClass("active")) return;
        $(".sidebar button").removeClass("active");
        $(this).addClass("active");
        calendarView.removeClass("active");
        logEntryView.addClass("active");
    });

    // Log Entry View Tıklaması
    logEntryView.on("click", function (event) {
        if (event.target === this) {
            const todayString = getFormattedDate(new Date());
            showLogInputOverlay(todayString);
        }
    });

    // Takvim Gün Tıklamaları (Yeni Ekleme/Düzenleme)
    calendarView.on("click", ".day-item:not(.disabled-day)", function (event) {
        if (!$(event.target).closest(".day-buttons button, .log-list .log-item").length) {
            const dateString = $(this).data("date");
            showLogInputOverlay(dateString);
        }
    });
    calendarView.on("click", ".no-logs:not(.holiday-info)", function(event) {
        event.stopPropagation();
        const dateString = $(this).closest('.day-item').data('date');
        if (!$(this).closest('.day-item').hasClass('disabled-day')) {
            showLogInputOverlay(dateString);
        }
    });
    calendarView.on("click", ".add-log-placeholder", function(event) {
        event.stopPropagation();
        const dateString = $(this).closest('.day-item').data('date');
        if (!$(this).closest('.day-item').hasClass('disabled-day')) {
            showLogInputOverlay(dateString);
        }
    });
    calendarView.on("click", ".log-item:not(.disabled-log)", async function (event) {
        event.stopPropagation(); // Prevent triggering day click
        // Check if we are dragging, if so, don't open edit overlay
        if (body.hasClass('dragging-log')) {
            return;
        }
        const $clickedLi = $(this);
        const logIndex = parseInt($clickedLi.data("log-index"), 10);
        const $dayItem = $clickedLi.closest(".day-item");
        const dateString = $dayItem.data("date");

        if (isNaN(logIndex) || $dayItem.hasClass("disabled-day")) return;

        const logs = allData[dateString] || [];
        const logData = logs[logIndex];
        if (logData) {
            const editData = { index: logIndex, text: logData.text, time: logData.time };
            showLogInputOverlay(dateString, editData);
        } else {
            console.error("Düzenlenecek log verisi bulunamadı:", dateString, logIndex);
            showToast("Log düzenlenemedi!");
        }
    });


    // --- Drag and Drop Event Listeners ---

    // Helper: Drop Indicator Yönetimi
    function createOrUpdateDropIndicator() {
        if (!dropIndicator) {
            dropIndicator = $('<li class="drop-indicator"></li>');
        }
        return dropIndicator;
    }
    function removeDropIndicator() {
        if (dropIndicator) {
            dropIndicator.remove();
            dropIndicator = null;
        }
    }

    calendarView.on("dragstart", ".log-item[draggable='true']", function (event) {
        const $logItem = $(this);
        const sourceDate = $logItem.data("source-date");
        const logIndex = parseInt($logItem.data("log-index"), 10);
        const logData = allData[sourceDate]?.[logIndex];

        if (!logData) {
            event.preventDefault(); return;
        }

        dragData = { sourceDate, logIndex, logData, element: this };
        event.originalEvent.dataTransfer.effectAllowed = 'move';
        // Tarayıcıya sürüklenen şeyin bir kopyasını göstermesini söyleyelim (isteğe bağlı)
        // event.originalEvent.dataTransfer.setData('text/plain', ''); // Firefox için gerekli olabilir
        setTimeout(() => $logItem.addClass("dragging"), 0); // Anında class eklenirse görsel takılabilir
        body.addClass("dragging-log");
    });

    calendarView.on("dragover", function (event) {
        event.preventDefault(); // Drop'a izin ver
        if (!dragData) return;

        const $targetElement = $(event.target);
        const $targetLogItem = $targetElement.closest('.log-item[draggable="true"]');
        const $targetLogList = $targetElement.closest('.log-list[data-droppable-list="true"]');
        const $targetDayItem = $targetElement.closest('.day-item[data-droppable="true"]');

        removeDropIndicator(); // Önceki işaretçiyi kaldır
        calendarView.find(".day-item.drag-over").removeClass("drag-over"); // Gün vurgusunu kaldır

        // --- Senaryo 1: Mevcut bir log item'ın üzerine gelindi (Sıralama) ---
        if ($targetLogItem.length && $targetLogItem[0] !== dragData.element) {
            const targetDate = $targetLogItem.data("source-date");
            // Sadece aynı gün içindeyse sıralama işaretçisi göster
            if (targetDate === dragData.sourceDate) {
                const rect = $targetLogItem[0].getBoundingClientRect();
                const mouseY = event.originalEvent.clientY;
                const indicator = createOrUpdateDropIndicator();
                if (mouseY < rect.top + rect.height / 2) {
                    $targetLogItem.before(indicator); // Üstüne bırakılacak
                } else {
                    $targetLogItem.after(indicator); // Altına bırakılacak
                }
                event.originalEvent.dataTransfer.dropEffect = 'move';
                return; // Başka kontrol yapma
            }
            // Farklı gün logunun üzerine gelindiyse, günü hedef al
        }

        // --- Senaryo 2: Boş bir log listesinin veya listenin sonunun üzerine gelindi (Sıralama/Ekleme) ---
         if ($targetLogList.length) {
            const $parentDayItem = $targetLogList.closest('.day-item');
            const targetDate = $parentDayItem.data("date");

            // Aynı gün içindeyse ve başka log yoksa veya listenin sonundaysak, sona ekle
            if (targetDate === dragData.sourceDate) {
                 // Listenin çocuklarını kontrol et, sürüklenen hariç en yakın öğeyi bul
                 const $logItems = $targetLogList.children('.log-item:not(.dragging)');
                 if ($logItems.length === 0) { // Liste boşsa (sadece sürüklenen vardı)
                    const indicator = createOrUpdateDropIndicator();
                    $targetLogList.append(indicator);
                    event.originalEvent.dataTransfer.dropEffect = 'move';
                    return;
                 } else {
                    // Son öğenin altına işaretçi koy (mouse log listesi üzerindeyse ama belirli bir item üzerinde değilse)
                    const listRect = $targetLogList[0].getBoundingClientRect();
                    if (event.originalEvent.clientY > listRect.top && event.originalEvent.clientY < listRect.bottom) {
                        const $lastItem = $logItems.last();
                        if (event.originalEvent.clientY > $lastItem[0].getBoundingClientRect().bottom - 5) { // Son öğenin altındaysa
                             const indicator = createOrUpdateDropIndicator();
                             $lastItem.after(indicator);
                             event.originalEvent.dataTransfer.dropEffect = 'move';
                             return;
                        }
                    }
                 }
            }
             // Farklı günün listesine gelindiyse, günü hedef al (aşağıdaki kod halleder)
         }


        // --- Senaryo 3: Bir günün üzerine gelindi (Header, boş alan vs.) (Günler Arası Taşıma) ---
        if ($targetDayItem.length) {
            const targetDate = $targetDayItem.data("date");
            if (targetDate !== dragData.sourceDate) { // Farklı bir güne taşıma
                 // Saat limitini kontrol et
                const targetLogs = allData[targetDate] || [];
                const currentTotalDuration = targetLogs.reduce((sum, log) => sum + (parseFloat(log.time) || 0), 0);
                const timeToAdd = parseFloat(dragData.logData.time) || 0;

                if (currentTotalDuration + timeToAdd <= MAX_DAILY_HOURS) {
                    $targetDayItem.addClass("drag-over"); // Gün vurgusu
                    event.originalEvent.dataTransfer.dropEffect = 'move';
                } else {
                    event.originalEvent.dataTransfer.dropEffect = 'none'; // Taşıma geçersiz
                }
            } else {
                 // Aynı günün boş alanına gelindiyse bir şey yapma (veya listenin sonuna ekleme mantığı eklenebilir)
                 event.originalEvent.dataTransfer.dropEffect = 'none';
            }
            return; // Başka kontrol yapma
        }

        // --- Hiçbir geçerli hedefe gelinemedi ---
        event.originalEvent.dataTransfer.dropEffect = 'none';
    });

    calendarView.on("dragleave", function (event) {
        // Eğer mouse takvim alanından tamamen çıkarsa işaretçiyi kaldır
        // Not: Bu, elementler arasında hızla gezinirken titreşime neden olabilir.
        // Daha sağlam bir yöntem dragend'de temizlemek.
        // const relatedTarget = event.originalEvent.relatedTarget;
        // if (!relatedTarget || !$.contains(calendarView[0], relatedTarget)) {
        //     removeDropIndicator();
        //     calendarView.find(".day-item.drag-over").removeClass("drag-over");
        // }
    });


    calendarView.on("drop", async function (event) {
        event.preventDefault();
        if (!dragData) return;

        const $dropTargetIndicator = calendarView.find(".drop-indicator");
        const $targetDayItemHighlighted = calendarView.find(".day-item.drag-over");

        const sourceDate = dragData.sourceDate;
        const sourceIndex = dragData.logIndex;
        const movedLogData = dragData.logData;

        // --- Senaryo 1: Aynı gün içinde sıralama (İşaretçi varsa) ---
        if ($dropTargetIndicator.length) {
            const $targetList = $dropTargetIndicator.closest('.log-list');
            const targetDate = $targetList.closest('.day-item').data('date');

            if (targetDate === sourceDate) { // Aynı gün teyidi
                 const logs = allData[targetDate];
                 // İşaretçinin DOM'daki pozisyonuna göre hedef index'i bul
                 let targetIndex = $dropTargetIndicator.index();
                 // Önemli: Eğer sürüklenen öğe, bırakılacak yerden daha önceyse,
                 // splice ile kaldırıldığında hedef index 1 azalır.
                 if (sourceIndex < targetIndex) {
                     targetIndex--;
                 }

                // Veri dizisini güncelle
                 logs.splice(sourceIndex, 1); // Önce kaldır
                 logs.splice(targetIndex, 0, movedLogData); // Sonra yeni yere ekle

                allData[targetDate] = logs; // Güncellenmiş diziyi ata
                await saveDataToStorage(allData);
                // Sadece etkilenen günü yeniden render et (daha verimli)
                await renderDayLogList(targetDate);
                showToast("Log sırası güncellendi.");
            }
             // İşaretçi var ama günler farklıysa bu bir hata durumudur, görmezden gel.
        }
        // --- Senaryo 2: Farklı bir güne taşıma (Gün vurgusu varsa) ---
        else if ($targetDayItemHighlighted.length) {
             const targetDate = $targetDayItemHighlighted.data("date");
             if (targetDate !== sourceDate) { // Farklı gün teyidi
                  // Saat limiti drop anında tekrar kontrol edilmeli (güvenlik için)
                const targetLogs = allData[targetDate] || [];
                const currentTotalDuration = targetLogs.reduce((sum, log) => sum + (parseFloat(log.time) || 0), 0);
                const timeToAdd = parseFloat(movedLogData.time) || 0;

                if (currentTotalDuration + timeToAdd <= MAX_DAILY_HOURS) {
                    // Kaynaktan sil
                     if (allData[sourceDate]) {
                         allData[sourceDate].splice(sourceIndex, 1);
                         if (allData[sourceDate].length === 0) {
                             delete allData[sourceDate];
                         }
                     }
                    // Hedefe ekle
                     if (!allData[targetDate]) {
                         allData[targetDate] = [];
                     }
                     allData[targetDate].push(movedLogData);

                    await saveDataToStorage(allData);
                    // Etkilenen her iki günü de yeniden render et
                    await renderDayLogList(sourceDate);
                    await renderDayLogList(targetDate);
                     showToast("Log taşındı.");
                 } else {
                     const remaining = (MAX_DAILY_HOURS - currentTotalDuration).toFixed(2);
                     showToast(`Taşıma başarısız: Günlük ${MAX_DAILY_HOURS} saat limiti aşılıyor (Kalan: ${remaining} saat).`);
                 }
            }
        }

        // Temizlik (her zaman çalışır)
        removeDropIndicator();
        $targetDayItemHighlighted.removeClass("drag-over");
        // dragend'de de temizlik var ama drop başarılıysa burada yapmak iyi olabilir
        $(dragData.element).removeClass("dragging");
        body.removeClass("dragging-log");
        dragData = null;
    });

    calendarView.on("dragend", function (event) {
        // Drop başarılı olsa da olmasa da bu çalışır.
        removeDropIndicator();
        calendarView.find(".day-item.drag-over").removeClass("drag-over");
        if (dragData && dragData.element) {
            $(dragData.element).removeClass("dragging");
        }
        body.removeClass("dragging-log");
        dragData = null; // Veriyi temizle
    });


    // --- Overlay İçindeki Olaylar ---
    timeOptionsContainer.on('click', '.time-option input[type="radio"]', function() {
        if ($(this).is(':checked')) {
            logTimeInput.val($(this).val()).trigger('input');
        }
    });
    timeOptionsContainer.on('dblclick', '.time-option label', function(event) {
        event.preventDefault();
        const $radioInput = $(this).prev('input[type="radio"]');
        if ($radioInput.length) {
            logTimeInput.val($radioInput.val()).trigger('input');
            if (!$radioInput.prop('checked')) {
                $radioInput.prop('checked', true);
            }
            saveLogButton.click();
        }
    });
    logTimeInput.on('input', function() {
        const currentValue = $(this).val();
        const matchingRadio = timeOptionsContainer.find(`.time-option input[type="radio"][value="${currentValue}"]`);
        if (matchingRadio.length) {
            matchingRadio.prop('checked', true);
        } else {
            timeOptionsContainer.find('.time-option input[type="radio"]').prop('checked', false);
        }
    });
    saveLogButton.on("click", async function () {
        const targetDate = logTargetDateInput.val();
        let text = logTextInput.val().trim();
        const time = logTimeInput.val().trim();
        const editingIndex = parseInt(editingLogIndexInput.val(), 10);
        editErrorMessage.text('');
        let success = false;
        if (editingIndex !== -1) {
            success = await updateLog(targetDate, editingIndex, text, time);
        } else {
            success = await saveLog(targetDate, text, time);
        }
        if (success) {
            hideLogInputOverlay();
            if (calendarView.hasClass("active")) {
                // Sadece etkilenen günü güncellemek daha verimli olurdu
                await renderDayLogList(targetDate); // Sadece günü render et
                // await renderFullCalendar(); // Eski yöntem: tüm takvimi render et
            }
            showToast(editingIndex !== -1 ? "Log güncellendi!" : "Log kaydedildi!");
        }
    });
    cancelLogButton.on("click", hideLogInputOverlay);
    logInputOverlay.on("click", function (event) {
        if (event.target === this) {
            hideLogInputOverlay();
        }
    });
    logInputOverlay.on("keypress", "input", function (event) {
        if (event.key === "Enter" || event.keyCode === 13) {
            event.preventDefault();
            saveLogButton.click();
        }
    });
    deleteLogButton.on("click", async function () {
        const targetDate = logTargetDateInput.val();
        const editingIndex = parseInt(editingLogIndexInput.val(), 10);
        if (editingIndex === -1 || !targetDate) return;
        const logs = allData[targetDate] || [];
        const logToDelete = logs[editingIndex];
        if (!logToDelete) {
            editErrorMessage.text("Silinecek log bulunamadı.");
            return;
        }
        if (confirm(`Bu logu silmek istediğinizden emin misiniz?\n\n"${logToDelete.text}"`)) {
            const success = await deleteLog(targetDate, editingIndex);
            if (success) {
                hideLogInputOverlay();
                if (calendarView.hasClass("active")) {
                    await renderDayLogList(targetDate); // Sadece günü render et
                    // await renderFullCalendar(); // Eski yöntem
                }
                showToast("Log silindi!");
            }
        }
    });
    $(document).on("keydown", function (event) {
        if (event.key === "Escape" && logInputOverlay.is(":visible")) {
            hideLogInputOverlay();
        }
    });

    // --- Takvim Günü Butonları ---
    calendarView.on("click", ".clear-day-logs", async function (event) {
        event.stopPropagation();
        const $button = $(this);
        const $dayItem = $button.closest(".day-item");
        const dateString = $dayItem.data("date");
        const displayDate = new Date(dateString);
        const formattedDisplayDate = `${displayDate.getDate()} ${getMonthName(displayDate.getMonth())} ${displayDate.getFullYear()}`;
        if (confirm(`${formattedDisplayDate} tarihinin tüm loglarını silmek istediğinizden emin misiniz?`)) {
            const success = await clearLogs(dateString);
            if(success) {
                 await renderDayLogList(dateString); // Sadece günü render et
                // await renderFullCalendar(); // Eski yöntem
                showToast(`${formattedDisplayDate} logları silindi.`);
            } else {
                showToast("Silinecek log bulunamadı.");
            }
        }
    });
    calendarView.on("click", ".copy-day-logs", async function (event) {
        event.stopPropagation();
        const $button = $(this);
        const dateString = $button.closest(".day-item").data("date");
        const logs = allData[dateString] || [];
        if (logs.length === 0) {
            showToast("Kopyalanacak log bulunamadı."); return;
        }
        const clipboardText = logs.map(log => `${log.text}\t${log.time}`).join("\n");
        try {
            await navigator.clipboard.writeText(clipboardText);
            showToast("Loglar panoya kopyalandı!");
            const originalIcon = $button.html();
            $button.html('<i class="fa-solid fa-check"></i>').addClass('copied').prop("disabled", true);
            setTimeout(() => {
                $button.html(originalIcon).removeClass('copied').prop("disabled", false);
            }, 1500);
        } catch (err) {
            console.error("Failed to copy logs: ", err);
            showToast("Kopyalama başarısız oldu!");
        }
    });

    // --- Başlangıç Yüklemesi ---
    async function initialize() {
        // Olay dinleyicilerini .ready() dışına almak yerine burada başlatma
        if (btnCalendar.hasClass("active")) {
            await renderFullCalendar();
        } else if (btnLogEntry.hasClass("active")) {
            // Başlangıçta log entry view için özel bir şey gerekmiyor
        }
    }

    initialize(); // Uygulamayı başlat
});