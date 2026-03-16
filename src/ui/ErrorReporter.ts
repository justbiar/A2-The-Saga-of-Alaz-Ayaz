/**
 * ErrorReporter.ts — Global hata yakalama ve kullanıcı bildirimi.
 * Console hataları yakalanır, kullanıcıya bildirim gösterilir,
 * isteğe bağlı olarak sunucuya raporlanır.
 */

import { ctx } from '../game/GameContext';

let _currentScreen = 'home';
let _lastErrorTime = 0;
const ERROR_COOLDOWN = 5000; // Aynı anda max 1 bildirim / 5 saniye

export function setErrorReporterScreen(screen: string): void {
    _currentScreen = screen;
}

async function sendReport(message: string, stack: string, url: string): Promise<void> {
    await fetch('/api/error-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            stack,
            url,
            screen: _currentScreen,
            wallet: ctx.walletAddress ?? null,
            userAgent: navigator.userAgent,
        }),
    });
}

function showErrorNotification(message: string, stack: string, url: string): void {
    const now = Date.now();
    if (now - _lastErrorTime < ERROR_COOLDOWN) return;
    _lastErrorTime = now;

    // Anlamsız / gürültülü hataları filtrele
    const msg = message.toLowerCase();
    if (
        msg.includes('resizeobserver') ||
        msg.includes('script error') ||
        msg.includes('network error') ||
        msg.includes('load failed')
    ) return;

    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 16px;
        max-width: 320px;
        background: rgba(20,10,10,0.96);
        border: 1px solid rgba(255,80,80,0.5);
        border-radius: 10px;
        padding: 12px 14px;
        z-index: 99999;
        font-family: 'Cinzel', serif;
        box-shadow: 0 4px 24px rgba(255,50,50,0.2);
        animation: errSlideIn 0.3s ease;
        color: #fff;
    `;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes errSlideIn {
            from { opacity: 0; transform: translateX(40px); }
            to   { opacity: 1; transform: translateX(0); }
        }
    `;
    document.head.appendChild(style);

    const short = message.length > 80 ? message.slice(0, 80) + '…' : message;

    notif.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="font-size:18px;line-height:1;">⚠️</div>
            <div style="flex:1;">
                <div style="font-size:11px;font-weight:700;color:#ff6666;letter-spacing:0.5px;margin-bottom:4px;">HATA OLUŞTU</div>
                <div style="font-size:10px;color:rgba(255,220,200,0.8);line-height:1.4;">${short}</div>
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <button id="err-report-btn" style="
                        padding:4px 12px;font-size:10px;font-family:inherit;
                        background:rgba(255,80,80,0.15);color:#ff9999;
                        border:1px solid rgba(255,80,80,0.4);border-radius:5px;cursor:pointer;
                        letter-spacing:0.5px;font-weight:700;
                    ">RAPOR ET</button>
                    <button id="err-close-btn" style="
                        padding:4px 10px;font-size:10px;font-family:inherit;
                        background:transparent;color:rgba(255,255,255,0.3);
                        border:1px solid rgba(255,255,255,0.1);border-radius:5px;cursor:pointer;
                    ">KAPAT</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(notif);

    const reportBtn = notif.querySelector('#err-report-btn') as HTMLButtonElement;
    const closeBtn = notif.querySelector('#err-close-btn') as HTMLButtonElement;

    const dismiss = () => {
        notif.style.animation = 'errSlideIn 0.2s ease reverse';
        setTimeout(() => notif.remove(), 200);
    };

    reportBtn.addEventListener('click', async () => {
        reportBtn.textContent = 'GÖNDERİLİYOR…';
        reportBtn.disabled = true;
        try {
            await sendReport(message, stack, url);
            reportBtn.textContent = 'GÖNDERİLDİ ✓';
            reportBtn.style.color = '#88ff88';
            reportBtn.style.borderColor = 'rgba(80,255,80,0.4)';
        } catch {
            reportBtn.textContent = 'BAŞARISIZ';
        }
        setTimeout(dismiss, 1500);
    });

    closeBtn.addEventListener('click', dismiss);

    // 12 saniye sonra otomatik kapat
    setTimeout(dismiss, 12000);
}

export function initErrorReporter(): void {
    window.addEventListener('error', (e) => {
        showErrorNotification(
            e.message || 'Bilinmeyen hata',
            e.error?.stack ?? '',
            e.filename ?? window.location.href,
        );
    });

    window.addEventListener('unhandledrejection', (e) => {
        const msg = e.reason?.message ?? String(e.reason) ?? 'Promise rejected';
        const stack = e.reason?.stack ?? '';
        showErrorNotification(msg, stack, window.location.href);
    });
}
