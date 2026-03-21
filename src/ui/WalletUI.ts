/**
 * WalletUI.ts — Wallet connection, EIP-6963 discovery, chain detection, dropdown.
 */

import { ctx } from '../game/GameContext';
import { showScreen } from './ScreenRouter';
import { t } from '../i18n';
import { profileService } from '../chain/ProfileService';
import { leaderboardService } from '../chain/LeaderboardService';
import { syncOnChainLeaderboard } from './ProfileLeaderboard';
import { showToast } from './LobbyUI';

const FUJI_CHAIN = {
    chainId: '0xa869',
    chainName: 'Avalanche Fuji Testnet',
    rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    blockExplorerUrls: ['https://testnet.snowtrace.io'],
};

// ─── DOM REFS ──────────────────────────────────────────────────────
const walletBtn = document.getElementById('wallet-btn') as HTMLButtonElement;
const walletLabel = document.getElementById('wallet-label') as HTMLElement;
const walletAvatar = document.getElementById('wallet-avatar') as HTMLImageElement;
const walletIcon = document.getElementById('wallet-icon') as HTMLElement;
const walletModal = document.getElementById('wallet-modal')!;
const walletModalClose = document.getElementById('wallet-modal-close')!;
const walletOptionsDiv = walletModal.querySelector('.wallet-options')!;
const ddProfile = document.getElementById('dd-profile')!;
const ddDisconnect = document.getElementById('dd-disconnect')!;
const walletDropdown = document.getElementById('wallet-dropdown')!;

// ─── EIP-6963 WALLET DISCOVERY ─────────────────────────────────────
interface EIP6963Provider {
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: any;
}

const discoveredWallets: EIP6963Provider[] = [];

window.addEventListener('eip6963:announceProvider', ((e: CustomEvent) => {
    const detail = e.detail as EIP6963Provider;
    if (!discoveredWallets.find(w => w.info.rdns === detail.info.rdns)) {
        discoveredWallets.push(detail);
    }
}) as EventListener);

window.dispatchEvent(new Event('eip6963:requestProvider'));

// ─── CHAIN DETECTION ───────────────────────────────────────────────
async function ensureFujiChain(provider: any): Promise<boolean> {
    try {
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (chainId === FUJI_CHAIN.chainId) return true;
        try {
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: FUJI_CHAIN.chainId }] });
            return true;
        } catch (switchErr: any) {
            if (switchErr.code === 4902) {
                await provider.request({ method: 'wallet_addEthereumChain', params: [FUJI_CHAIN] });
                return true;
            }
            throw switchErr;
        }
    } catch (err: any) {
        console.error('Chain switch failed:', err);
        return false;
    }
}

// ─── CONNECT ───────────────────────────────────────────────────────
export async function connectWithProvider(provider: any, silent = false, rdns = ''): Promise<void> {
    const _ethers = (window as any).ethers;
    if (!_ethers) {
        if (!silent) alert('ethers kutuphanesi yuklenemedi!');
        return;
    }

    try {
        if (silent) {
            const accounts: string[] = await provider.request({ method: 'eth_accounts' });
            if (!accounts.length) return;
        } else {
            try {
                await provider.request({
                    method: 'wallet_requestPermissions',
                    params: [{ eth_accounts: {} }],
                });
            } catch (permErr: any) {
                if (permErr.code === 4001) return;
                await provider.request({ method: 'eth_requestAccounts' });
            }
        }

        const onFuji = await ensureFujiChain(provider);
        if (!onFuji) {
            walletLabel.textContent = '⚠ Wrong Chain';
            walletBtn.classList.add('connected');
            walletBtn.style.borderColor = 'rgba(255,180,0,0.5)';
            walletBtn.style.color = '#ffaa00';
            return;
        }

        ctx._activeProvider = provider;
        (window as any).__activeProvider = provider;
        const ethProvider = new _ethers.BrowserProvider(provider);
        const signer = await ethProvider.getSigner();
        ctx.walletAddress = await signer.getAddress();
        (window as any).__walletAddress = ctx.walletAddress;
        localStorage.setItem('a2_wallet_address', ctx.walletAddress!);
        if (rdns) localStorage.setItem('a2_wallet_rdns', rdns);
        const balance = await ethProvider.getBalance(ctx.walletAddress);
        const balStr = parseFloat(_ethers.formatEther(balance)).toFixed(3);

        const short = ctx.walletAddress!.slice(0, 6) + '...' + ctx.walletAddress!.slice(-4);
        walletLabel.textContent = `${short} · ${balStr} AVAX`;
        walletBtn.classList.add('connected');
        walletBtn.style.borderColor = '';
        walletBtn.style.color = '';

        profileService.walletAddress = ctx.walletAddress;
        profileService.isConnected = true;
        await profileService.loadProfile();
        if (!profileService.currentProfile) {
            leaderboardService.upsertPlayer(ctx.walletAddress!, short);
            lockGameUntilProfile(true);
            showScreen('profile');
        } else {
            leaderboardService.upsertPlayer(ctx.walletAddress!, profileService.currentProfile.username);
            lockGameUntilProfile(false);
        }
        updateWalletAvatar();

        syncOnChainLeaderboard().catch(() => { });

        const lobbyScreen = document.getElementById('lobby-screen') as HTMLElement;
        if (lobbyScreen.style.display !== 'none') {
            // Will be re-initialized when lobby opens
        }

        provider.on?.('chainChanged', async (newChainId: string) => {
            if (newChainId !== FUJI_CHAIN.chainId) {
                walletLabel.textContent = '⚠ Wrong Chain';
                walletBtn.style.borderColor = 'rgba(255,180,0,0.5)';
                walletBtn.style.color = '#ffaa00';
            } else {
                const ep = new _ethers.BrowserProvider(provider);
                const s = await ep.getSigner();
                const bal = await ep.getBalance(await s.getAddress());
                const bs = parseFloat(_ethers.formatEther(bal)).toFixed(3);
                const sh = ctx.walletAddress!.slice(0, 6) + '...' + ctx.walletAddress!.slice(-4);
                walletLabel.textContent = `${sh} · ${bs} AVAX`;
                walletBtn.style.borderColor = '';
                walletBtn.style.color = '';
            }
        });

        provider.on?.('accountsChanged', async (accounts: string[]) => {
            if (!accounts.length) {
                ctx.walletAddress = null;
                (window as any).__walletAddress = null;
                ctx._activeProvider = null;
                (window as any).__activeProvider = null;
                localStorage.removeItem('a2_wallet_address');
                localStorage.removeItem('a2_wallet_rdns');
                profileService.walletAddress = null;
                profileService.isConnected = false;
                profileService.currentProfile = null;
                walletLabel.textContent = t('connectWallet' as any);
                walletBtn.classList.remove('connected');
                walletBtn.style.borderColor = '';
                walletBtn.style.color = '';
            } else {
                const ep = new _ethers.BrowserProvider(provider);
                const s = await ep.getSigner();
                ctx.walletAddress = await s.getAddress();
                (window as any).__walletAddress = ctx.walletAddress;
                localStorage.setItem('a2_wallet_address', ctx.walletAddress!);
                const bal = await ep.getBalance(ctx.walletAddress);
                const bs = parseFloat(_ethers.formatEther(bal)).toFixed(3);
                const sh = ctx.walletAddress!.slice(0, 6) + '...' + ctx.walletAddress!.slice(-4);
                walletLabel.textContent = `${sh} · ${bs} AVAX`;
                walletBtn.classList.add('connected');
                walletBtn.style.borderColor = '';
                walletBtn.style.color = '';
                profileService.walletAddress = ctx.walletAddress;
                profileService.isConnected = true;
                profileService.currentProfile = null;
                await profileService.loadProfile();
                if (!profileService.currentProfile) {
                    leaderboardService.upsertPlayer(ctx.walletAddress!, sh);
                    lockGameUntilProfile(true);
                    showScreen('profile');
                } else {
                    const prof = profileService.currentProfile as any;
                    leaderboardService.upsertPlayer(ctx.walletAddress!, prof.username);
                    lockGameUntilProfile(false);
                }
            }
        });
    } catch (err: any) {
        console.error('Wallet connection failed:', err);
        if (!silent) alert('Cuzdan baglantisi basarisiz: ' + (err.message || err));
    }
}

// ─── WALLET MODAL ──────────────────────────────────────────────────
export function showWalletModal(): void {
    walletOptionsDiv.innerHTML = '';

    if (discoveredWallets.length === 0) {
        walletOptionsDiv.innerHTML = `
            <div class="wallet-no-wallets">
                <div class="wallet-no-wallets-icon">🦊</div>
                <div class="wallet-no-wallets-text">Desteklenen bir cuzdan bulunamadi.<br>Devam etmek icin MetaMask kurun.</div>
                <a href="https://metamask.io/download/" target="_blank" class="wallet-install-btn">MetaMask Indir →</a>
            </div>`;
    } else {
        for (const w of discoveredWallets) {
            const opt = document.createElement('div');
            opt.className = 'wallet-option detected';
            opt.innerHTML = `
                <img src="${w.info.icon}" class="wallet-option-icon" style="width:36px;height:36px;border-radius:8px;" alt="${w.info.name}" />
                <div class="wallet-option-info">
                    <div class="wallet-option-name">${w.info.name}</div>
                </div>
                <div class="wallet-option-arrow">›</div>`;
            opt.addEventListener('click', async () => {
                walletModal.classList.remove('show');
                await connectWithProvider(w.provider, false, w.info.rdns);
            });
            walletOptionsDiv.appendChild(opt);
        }
    }

    walletModal.classList.add('show');
}

// ─── LOCK GAME ─────────────────────────────────────────────────────
export function lockGameUntilProfile(locked: boolean): void {
    const playBtn = document.getElementById('nav-play');
    if (playBtn) {
        (playBtn as HTMLButtonElement).disabled = locked;
        playBtn.style.opacity = locked ? '0.35' : '';
        playBtn.style.cursor = locked ? 'not-allowed' : '';
        playBtn.title = locked ? 'Oyuna girmek icin profil olustur' : '';
    }
}

// ─── WIRING ────────────────────────────────────────────────────────
export function initWalletUI(): void {
    walletModalClose.addEventListener('click', () => walletModal.classList.remove('show'));
    walletModal.addEventListener('click', (e) => {
        if (e.target === walletModal) walletModal.classList.remove('show');
    });

    walletBtn.addEventListener('click', () => {
        if (!ctx.walletAddress) {
            if (walletLabel.textContent === '⚠ Wrong Chain' && ctx._activeProvider) {
                ensureFujiChain(ctx._activeProvider).then(ok => {
                    if (ok) connectWithProvider(ctx._activeProvider);
                });
                return;
            }
            showWalletModal();
        } else {
            const dd = document.getElementById('wallet-dropdown')!;
            dd.classList.toggle('show');
        }
    });

    ddProfile.addEventListener('click', () => {
        walletDropdown.classList.remove('show');
        showScreen('profile');
    });

    ddDisconnect.addEventListener('click', () => {
        walletDropdown.classList.remove('show');
        ctx.walletAddress = null;
        (window as any).__walletAddress = null;
        ctx._activeProvider = null;
        (window as any).__activeProvider = null;
        localStorage.removeItem('a2_wallet_address');
        localStorage.removeItem('a2_wallet_rdns');
        profileService.walletAddress = null;
        profileService.isConnected = false;
        profileService.currentProfile = null;
        walletLabel.textContent = t('connectWallet' as any);
        walletBtn.classList.remove('connected');
        walletBtn.style.borderColor = '';
        walletBtn.style.color = '';
        walletAvatar.style.display = 'none';
        walletIcon.style.display = '';
        lockGameUntilProfile(true);
        showScreen('home');
    });

    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('wallet-wrapper')!;
        if (!wrapper.contains(e.target as Node)) {
            walletDropdown.classList.remove('show');
        }
    });

    // Auto-reconnect
    setTimeout(async () => {
        const savedAddr = localStorage.getItem('a2_wallet_address');
        if (!savedAddr) return;
        const savedRdns = localStorage.getItem('a2_wallet_rdns') || '';
        let autoProvider: any = null;
        let matchedRdns = '';
        if (savedRdns && discoveredWallets.length > 0) {
            const match = discoveredWallets.find(w => w.info.rdns === savedRdns);
            if (match) {
                autoProvider = match.provider;
                matchedRdns = match.info.rdns;
            }
        }
        if (!autoProvider) autoProvider = (window as any).ethereum;
        if (!autoProvider) return;
        try {
            const accounts: string[] = await autoProvider.request({ method: 'eth_requestAccounts' });
            if (accounts.length > 0) {
                await connectWithProvider(autoProvider, true, matchedRdns);
            }
        } catch (e) {
            localStorage.removeItem('a2_wallet_address');
            localStorage.removeItem('a2_wallet_rdns');
        }
    }, 500);

    lockGameUntilProfile(true);
}

/** Wallet butonundaki avatari profil bilgisine gore guncelle */
export function updateWalletAvatar(): void {
    const profile = profileService.currentProfile;
    if (profile && profile.avatarURI) {
        walletAvatar.src = profile.avatarURI;
        walletAvatar.style.display = '';
        walletIcon.style.display = 'none';
    } else {
        walletAvatar.style.display = 'none';
        walletIcon.style.display = '';
    }
}
