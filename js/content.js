// Yüzen butonu oluştur
const fab = document.createElement('button');
fab.id = 'effort-logger-fab';
fab.innerHTML = '<i class="fa-solid fa-plus"></i>'; // İkonu HTML olarak ekle
fab.title = 'Efor Loglarını Görüntüle/Ekle'; // Tooltip güncellendi

// Font Awesome stillerini sayfaya ekle (Eğer sayfada zaten yoksa)
if (!document.querySelector('link[href*="font-awesome"]')) {
    const faLink = document.createElement('link');
    faLink.rel = 'stylesheet';
    faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'; // CDN kullanıyoruz
    document.head.appendChild(faLink);
}


// Butona tıklanınca log sayfasını yeni sekmede açmak için arka plana mesaj gönder
fab.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "openLogPage" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("FAB: Background script'e mesaj gönderilemedi:", chrome.runtime.lastError.message);
            // Belki burada kullanıcıya bir uyarı gösterilebilir
        } else {
            // console.log("FAB: Log sayfası açma isteği gönderildi.");
        }
    });
});

// Butonu sayfaya ekle (body yüklendikten sonra eklemek daha güvenli)
if (document.body) {
    document.body.appendChild(fab);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(fab);
    });
}

// --- NOT ---
// '+' butonu hala log sayfasını açıyor. Popup açmak için background script ile
// karmaşık bir iletişim veya content script içine modal enjekte etmek gerekir.
// Mevcut yapı daha standart ve stabildir.
