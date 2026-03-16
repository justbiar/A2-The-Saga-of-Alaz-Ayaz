/**
 * ReportUI.ts — Feedback / Bug Report modal.
 * Header ve ESC menusunden acilir. Kullanici oneri/sikayet/bug report gonderir.
 */

import { ctx } from '../game/GameContext';
import { t } from '../i18n';

let _modal: HTMLElement | null = null;

function createModal(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'report-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99998;
        display:flex;align-items:center;justify-content:center;
        animation:reportFadeIn 0.2s ease;
    `;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes reportFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes reportSlideUp { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
        .report-type-btn { padding:6px 14px;font-size:12px;font-family:'Cinzel',serif;background:rgba(255,255,255,0.06);
            color:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.12);border-radius:6px;cursor:pointer;transition:all 0.15s; }
        .report-type-btn:hover { background:rgba(255,255,255,0.1);color:#fff; }
        .report-type-btn.active { background:rgba(255,100,100,0.15);color:#ff9999;border-color:rgba(255,100,100,0.4); }
    `;
    document.head.appendChild(style);

    overlay.innerHTML = `
        <div style="
            background:rgba(15,10,20,0.98);border:1px solid rgba(255,100,100,0.25);border-radius:14px;
            padding:24px 28px;max-width:420px;width:90%;animation:reportSlideUp 0.25s ease;
            font-family:'Cinzel',serif;box-shadow:0 8px 40px rgba(0,0,0,0.5);
        ">
            <div style="font-size:16px;font-weight:700;color:#ff6b6b;letter-spacing:1px;margin-bottom:4px;">${t('reportTitle' as any)}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:16px;">${t('reportSubtitle' as any)}</div>

            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
                <button class="report-type-btn active" data-type="bug">Bug</button>
                <button class="report-type-btn" data-type="suggestion">${t('reportSuggestion' as any)}</button>
                <button class="report-type-btn" data-type="complaint">${t('reportComplaint' as any)}</button>
                <button class="report-type-btn" data-type="other">${t('reportOther' as any)}</button>
            </div>

            <textarea id="report-message" placeholder="${t('reportPlaceholder' as any)}" style="
                width:100%;height:100px;background:rgba(255,255,255,0.04);color:#eee;border:1px solid rgba(255,255,255,0.12);
                border-radius:8px;padding:10px;font-size:12px;font-family:'Cinzel',serif;resize:vertical;
                outline:none;box-sizing:border-box;
            "></textarea>

            <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
                <button id="report-cancel" style="
                    padding:8px 18px;font-size:12px;font-family:'Cinzel',serif;background:transparent;
                    color:rgba(255,255,255,0.4);border:1px solid rgba(255,255,255,0.12);border-radius:6px;cursor:pointer;
                ">${t('cancel')}</button>
                <button id="report-send" style="
                    padding:8px 22px;font-size:12px;font-family:'Cinzel',serif;font-weight:700;
                    background:rgba(255,80,80,0.15);color:#ff9999;border:1px solid rgba(255,80,80,0.4);
                    border-radius:6px;cursor:pointer;letter-spacing:0.5px;
                ">${t('reportSend' as any)}</button>
            </div>
        </div>
    `;

    return overlay;
}

export function openReportModal(): void {
    if (_modal) return;
    _modal = createModal();
    document.body.appendChild(_modal);

    let selectedType = 'bug';

    // Type butonlari
    _modal.querySelectorAll('.report-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _modal!.querySelectorAll('.report-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedType = (btn as HTMLElement).dataset.type ?? 'other';
        });
    });

    // Cancel
    _modal.querySelector('#report-cancel')!.addEventListener('click', closeReportModal);
    _modal.addEventListener('click', (e) => {
        if (e.target === _modal) closeReportModal();
    });

    // Send
    const sendBtn = _modal.querySelector('#report-send') as HTMLButtonElement;
    const textarea = _modal.querySelector('#report-message') as HTMLTextAreaElement;

    sendBtn.addEventListener('click', async () => {
        const msg = textarea.value.trim();
        if (msg.length < 3) {
            textarea.style.borderColor = 'rgba(255,80,80,0.6)';
            textarea.placeholder = 'En az 3 karakter yazin...';
            return;
        }
        sendBtn.textContent = '...';
        sendBtn.disabled = true;
        try {
            await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: selectedType,
                    message: msg,
                    wallet: ctx.walletAddress ?? null,
                    userAgent: navigator.userAgent,
                }),
            });
            sendBtn.textContent = 'GONDERILDI';
            sendBtn.style.color = '#88ff88';
            sendBtn.style.borderColor = 'rgba(80,255,80,0.4)';
            setTimeout(closeReportModal, 1000);
        } catch {
            sendBtn.textContent = 'BASARISIZ';
            sendBtn.disabled = false;
            setTimeout(() => { sendBtn.textContent = 'GONDER'; }, 2000);
        }
    });

    textarea.focus();
}

export function closeReportModal(): void {
    if (!_modal) return;
    _modal.style.animation = 'reportFadeIn 0.15s ease reverse';
    const m = _modal;
    _modal = null;
    setTimeout(() => m.remove(), 150);
}

export function initReportUI(): void {
    document.getElementById('nav-report-header')?.addEventListener('click', openReportModal);
    document.getElementById('esc-report')?.addEventListener('click', () => {
        // ESC menusunu kapat, report ac
        const escOverlay = document.getElementById('esc-overlay');
        if (escOverlay) escOverlay.style.display = 'none';
        openReportModal();
    });
}
