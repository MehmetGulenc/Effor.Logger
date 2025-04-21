// Content script'ten gelen mesajı dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "openLogPage") {
        // log.html sayfasını yeni bir sekmede aç
        chrome.tabs.create({ url: chrome.runtime.getURL("html/log.html") });
        sendResponse({ success: true }); // Mesajın işlendiğini bildir (opsiyonel)
    }
    return true; // Asenkron yanıtlar için gerekli olabilir
});

// Eklenti kurulduğunda veya güncellendiğinde varsayılan verileri ayarlama (opsiyonel)
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['effortLogData'], (result) => {
        if (!result.effortLogData) {
            chrome.storage.local.set({ effortLogData: {} }, () => {
                console.log('Efor Kayıt Aracı: Başlangıç verisi ayarlandı.');
            });
        }
    });
});
