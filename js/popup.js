document.addEventListener('DOMContentLoaded', () => {
    // Element Referansları (ID'ler güncellendi)
    const logTextInputPopup = document.getElementById('log-text-input-popup');
    const timeOptionsContainerPopup = document.querySelector('.time-options-container');
    const saveButtonPopup = document.getElementById('save-button-popup');
    const errorMessagePopup = document.getElementById('error-message-popup');
    const viewLogsLinkPopup = document.getElementById('view-logs-link-popup');

    const MAX_DAILY_HOURS = 8.0;
    // Popup için zaman seçenekleri (log.js ile aynı olabilir veya farklı)
    const commonPopupDurations = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 8.0]; // Örnek

    // Hızlı zaman seçimi radio butonlarını oluşturur (Popup için)
    function populateTimeOptionsPopup() {
        timeOptionsContainerPopup.innerHTML = ''; // Önce temizle
        let defaultChecked = false; // Varsayılan seçildi mi?

        commonPopupDurations.forEach((duration) => {
            const valueStr = duration.toFixed(2);
            // .00 varsa kaldır
            const displayValue = parseFloat(valueStr).toString();
            const id = `time-popup-${displayValue.replace('.', '-')}`; // Benzersiz ID

            const optionDiv = document.createElement('div');
            optionDiv.className = 'time-option';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.id = id;
            radio.name = 'popup-quick-duration';
            radio.value = displayValue; // Kaydedilecek değer

            // Varsayılan olarak 1.0 saati seçili yapalım
            if (duration === 1.0) {
                radio.checked = true;
                defaultChecked = true;
            }

            const label = document.createElement('label');
            label.htmlFor = id;
            label.textContent = `${displayValue} h`;

            optionDiv.appendChild(radio);
            optionDiv.appendChild(label);
            timeOptionsContainerPopup.appendChild(optionDiv);

            // Radio değiştikçe hata mesajını temizle (isteğe bağlı)
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    errorMessagePopup.textContent = '';
                }
            });
        });

        // Eğer 1.0 yoksa veya başka bir nedenle varsayılan seçilemediyse, ilkini seç
        if (!defaultChecked && commonPopupDurations.length > 0) {
            const firstRadio = timeOptionsContainerPopup.querySelector('input[type="radio"]');
            if (firstRadio) {
                firstRadio.checked = true;
            }
        }
    }

    // Bugünün tarihini YYYY-MM-DD formatında al
    function getTodayDateString() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Veriyi chrome.storage.local'a kaydet (log.js ile aynı formatta: {text, time})
    async function saveDataPopup() {
        const text = logTextInputPopup.value.trim();
        const selectedRadio = timeOptionsContainerPopup.querySelector('input[name="popup-quick-duration"]:checked');
        const todayStr = getTodayDateString();

        errorMessagePopup.textContent = ''; // Hata mesajını temizle

        if (!text) {
            errorMessagePopup.textContent = 'Açıklama boş olamaz.';
            logTextInputPopup.focus();
            return;
        }

        if (!selectedRadio) {
            errorMessagePopup.textContent = 'Lütfen bir süre seçin.';
            return; // Normalde olmamalı ama kontrol ekleyelim
        }

        const timeStr = selectedRadio.value;
        const timeValue = parseFloat(timeStr);

        if (isNaN(timeValue) || timeValue <= 0) {
            // Bu da normalde olmamalı
            errorMessagePopup.textContent = 'Geçersiz süre seçimi.';
            return;
        }

        try {
            // Mevcut veriyi chrome.storage'dan oku
            const result = await chrome.storage.local.get(['effortLogData']);
            const allData = result.effortLogData || {};
            const todayEntries = allData[todayStr] || [];

            // Günlük toplam süreyi hesapla
            let currentTotalDuration = todayEntries.reduce((sum, entry) => sum + (parseFloat(entry.time) || 0), 0);

            // Yeni eklenecek süre ile 8 saat limitini kontrol et
            if (currentTotalDuration + timeValue > MAX_DAILY_HOURS) {
                const remaining = (MAX_DAILY_HOURS - currentTotalDuration).toFixed(2);
                errorMessagePopup.textContent = `Günlük ${MAX_DAILY_HOURS} saat limiti aşılamaz. Kalan: ${remaining} saat.`;
                return;
            }

            // Yeni kaydı ekle ({text, time} formatında, time string olarak formatlı)
            todayEntries.push({ text: text, time: timeValue.toFixed(2) });
            allData[todayStr] = todayEntries;

            // Güncellenmiş veriyi chrome.storage'a kaydet
            await chrome.storage.local.set({ effortLogData: allData });

            // Başarılı kayıttan sonra popup'ı kapat
            window.close();

        } catch (error) {
            console.error('Veri kaydedilirken hata:', error);
            errorMessagePopup.textContent = 'Bir hata oluştu, kayıt yapılamadı.';
        }
    }

    // Kaydet butonuna tıklama olayı
    saveButtonPopup.addEventListener('click', saveDataPopup);

    // Enter tuşu ile kaydetme (açıklama alanındayken)
    logTextInputPopup.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            // Zaman seçiliyse kaydetmeyi dene
            const selectedRadio = timeOptionsContainerPopup.querySelector('input[name="popup-quick-duration"]:checked');
            if (selectedRadio) {
                saveDataPopup();
            } else {
                errorMessagePopup.textContent = 'Lütfen bir süre seçin.';
            }
        }
    });

    // Logları görüntüle linkine tıklama olayı
    viewLogsLinkPopup.addEventListener('click', (e) => {
        e.preventDefault();
        // background.js'e log sayfasını açması için mesaj gönder
        chrome.runtime.sendMessage({ action: "openLogPage" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Background script'e mesaj gönderilemedi:", chrome.runtime.lastError.message);
                // Doğrudan açmayı dene (fallback)
                try {
                    chrome.tabs.create({ url: chrome.runtime.getURL("html/log.html") });
                } catch (tabError) {
                    console.error("Log sayfası doğrudan açılamadı:", tabError);
                    alert("Log sayfası açılamadı. Lütfen tekrar deneyin.");
                }
            } else if (response && response.success) {
                // console.log("Log sayfası açma isteği gönderildi.");
            } else {
                // console.log("Background script'ten beklenmeyen yanıt:", response);
            }
        });
        window.close(); // Mesaj gönderildikten sonra popup'ı kapat
    });

    // Başlangıçta süre seçeneklerini doldur
    populateTimeOptionsPopup();

    // Açıklama alanına odaklan
    logTextInputPopup.focus();

}); // DOMContentLoaded sonu
