# EfforLogger - Efor Kayıt Aracı v1.2

Günlük eforlarınızı akıcı bir şekilde kaydetmenize, takvim üzerinde görüntülemenize ve yıl sonu özetleri almanıza yardımcı olan bir Chrome eklentisi.

## Özellikler

*   **Hızlı Kayıt:** Eklenti popup'ı veya ana takvim sayfası üzerinden kolayca log girişi.
*   **Doğal Dil İşleme (Popup):** "Toplantı 1.5 saat" gibi girişleri otomatik ayrıştırır.
*   **Takvim Görünümü:** Aylık takvimde logları ve günlük toplam süreleri görüntüleyin.
*   **Sürükle & Bırak:**
    *   Logları günler arasında taşıyın.
    *   Logları **aynı gün içinde** yeniden sıralayın.
*   **Kopya İşlemleri:**
    *   Günün loglarını panoya kopyalayın.
    *   Günün loglarını bir sonraki *iş gününe* kopyalayın (hafta sonları ve tatilleri atlar).
*   **Tema Desteği:** Açık ve Koyu tema seçenekleri (sistem tercihini algılar veya manuel seçilebilir).
*   **Özet Görünümü:**
    *   **Yıllık Yoğunluk Haritası:** GitHub benzeri heatmap (Cal-Heatmap ile).
    *   **Aylık Efor Grafiği:** Aylara göre toplam eforu gösteren çubuk grafik (Chart.js ile).
    *   **İlginç Gerçekler:** Yılın en yoğun günü, en sık açıklama, en uzun seri gibi istatistikler.
*   **Jira Entegrasyonu (Temel):**
    *   Log açıklamalarındaki Jira Issue Key'lerini (örn., ABC-123) algılar ve ikon ekler.
    *   (Gelecek Geliştirme) Tıklandığında Jira'dan özet bilgisi çekme (Kurulum gerektirir).
*   **Kullanıcı Dostu Arayüz:** Modern görünüm, ipuçları ve klavye kısayolları.
*   **Kişiselleştirme (Potansiyel):** Renk paleti ayarları için altyapı (Ayarlar sayfası gerektirir).

## Kurulum

1.  **Eklentiyi Yükleme:**
    *   Bu projenin dosyalarını bilgisayarınıza indirin (veya klonlayın).
    *   Chrome'u açın ve adres çubuğuna `chrome://extensions/` yazıp Enter'a basın.
    *   Sağ üst köşedeki "Geliştirici modu" anahtarını etkinleştirin.
    *   Sol üstteki "Paketlenmemiş öğe yükle" düğmesine tıklayın.
    *   İndirdiğiniz proje klasörünü (içinde `manifest.json` bulunan klasörü) seçin.
    *   Eklenti yüklenmiş olmalı.

## Kullanım

*   **Log Ekleme (Popup):**
    *   Chrome araç çubuğundaki eklenti ikonuna tıklayın.
    *   Açıklamayı girin. Süreyi metnin sonuna (örn., "Debug 2 saat", "Toplantı 0.5") ekleyebilir veya alttaki seçeneklerden birini seçebilirsiniz.
    *   "Kaydet"e tıklayın veya Enter'a basın. Zaman seçeneği etiketine çift tıklamak da kaydeder.
*   **Log Ekleme/Düzenleme (Takvim Sayfası):**
    *   Popup'taki "Tüm Kayıtları Görüntüle" linkine tıklayın veya eklentiyi sağ tıklayıp ilgili seçeneği seçin (varsa).
    *   Boş bir güne veya "Log ekle" yazısına tıklayarak yeni log ekleyin.
    *   Var olan bir loga tıklayarak düzenleyin.
    *   Logları günler arasında veya aynı gün içinde sürükleyip bırakın.
*   **Görünümler Arası Geçiş:** Sol taraftaki ikonları kullanarak Takvim, Özet vb. görünümler arasında geçiş yapın.
*   **Tema Değiştirme:** Sol alttaki Güneş/Ay ikonuna tıklayın.

## Kurulum Gerektiren Özellikler

### 1. Grafikler (Chart.js & Cal-Heatmap)

Özet sayfasındaki grafiklerin çalışması için gerekli JavaScript kütüphaneleri **CDN üzerinden** yüklenmektedir (`log.html` içerisindeki `<script>` etiketleri). İnternet bağlantınızın olması gerekir.

*   Eğer kütüphaneleri yerel olarak kullanmak isterseniz:
    *   Chart.js ve Cal-Heatmap (+ bağımlılığı D3.js) kütüphanelerini indirin.
    *   Proje klasörünüzde uygun bir yere (örn. `js/libs/`) kopyalayın.
    *   `log.html` dosyasındaki CDN `<script>` etiketlerini yorum satırı yapın veya silin.
    *   Yerel dosya yollarını gösteren yeni `<script>` etiketleri ekleyin.

### 2. Jira Entegrasyonu (Özet Bilgisi Çekme - Geliştirme Aşamasında)

Şu anda eklenti sadece log metnindeki Jira anahtarlarını tanıyıp ikon gösterir. Tıklandığında Jira'dan özet bilgisini çekme özelliği **aktif değildir** ve aşağıdaki adımları gerektirir (gelecekte eklenebilir):

1.  **Jira API Token Oluşturma:**
    *   Jira hesabınıza gidin: `Hesap Ayarları` -> `Güvenlik` -> `API belirteci oluştur`.
    *   Bir belirteç (token) oluşturun ve **güvenli bir yere kaydedin**. Bu token şifreniz gibidir.
2.  **Eklenti Ayarları (Gelecekte):**
    *   Eklentiye bir "Ayarlar" sayfası eklendiğinde, buraya Jira bilgilerinizi girmeniz gerekecektir:
        *   **Jira Domain:** Jira Cloud adresiniz (örn., `sirketiniz.atlassian.net`).
        *   **Jira E-posta:** Jira'ya giriş yaptığınız e-posta adresi.
        *   **Jira API Token:** 1. adımda oluşturduğunuz API belirteci.
    *   Bu bilgiler `chrome.storage.sync` içinde saklanacaktır.
3.  **Background Script:** `js/background.js` içerisindeki `fetchJiraIssueSummary` fonksiyonunun, bu ayarlara erişip Jira API'sine istek atacak şekilde tamamlanması gerekir.

**Not:** API token'ınızı doğrudan koda yazmayın! Güvenli bir şekilde ayarlardan alınmalıdır.

## Klavye Kısayolları

*   **Popup Açma:** `Ctrl+Shift+E` (veya `Cmd+Shift+E` Mac'te) - `chrome://extensions/shortcuts` adresinden değiştirebilirsiniz.
*   **Takvim Sayfasında:**
    *   `N`: Bugün için yeni log ekleme modalını açar.
    *   `Ctrl + Sol/Sağ Ok`: Aylar arasında geçiş yapar.
    *   `Esc`: Açık olan log ekleme/düzenleme modalını kapatır.
*   **Modal İçinde:**
    *   `Enter` (Açıklama alanında): İmleci Süre alanına taşır.
    *   `Enter` (Süre alanında veya Zaman Seçeneklerinde): Logu kaydeder.
    *   `Yukarı/Aşağı/Sol/Sağ Ok` (Zaman Seçeneklerinde): Seçenekler arasında gezinir.
    *   `Esc`: Modalı kapatır.

## Geliştirme & Katkı

Proje açık kaynaklıdır (varsayımsal olarak). Hata bildirimi veya özellik isteği için GitHub Issues bölümünü kullanabilirsiniz.