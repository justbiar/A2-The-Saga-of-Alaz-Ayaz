// Avalanche Fuji Testnet Configuration
const AVALANCHE_FUJI_CONFIG = {
    chainId: '0xA869', // 43113 in hex
    chainName: 'Avalanche Fuji Testnet',
    nativeCurrency: {
        name: 'AVAX',
        symbol: 'AVAX',
        decimals: 18
    },
    rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
    blockExplorerUrls: ['https://testnet.snowtrace.io/']
};

// Wallet connection functions
async function connectWallet() {
    const connectBtn = document.getElementById('connectWallet');
    const statusEl = document.getElementById('walletStatus');
    const walletInfo = document.getElementById('walletInfo');
    const addressEl = document.getElementById('walletAddress');
    const balanceEl = document.getElementById('walletBalance');
    
    // Add loading state
    connectBtn.classList.add('loading');
    connectBtn.querySelector('.btn-text').textContent = 'Bağlanıyor...';
    
    try {
        // Check if MetaMask is installed
        if (typeof window.ethereum === 'undefined') {
            throw new Error('MetaMask yüklü değil! Lütfen MetaMask uzantısını yükleyin.');
        }
        
        // Request account access
        const accounts = await window.ethereum.request({ 
            method: 'eth_requestAccounts' 
        });
        
        if (accounts.length === 0) {
            throw new Error('Hesap bulunamadı. Lütfen MetaMask\'ta bir hesap oluşturun.');
        }
        
        const account = accounts[0];
        
        // Switch to Avalanche Fuji Testnet
        await switchToAvalancheFuji();
        
        // Get balance
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const balance = await provider.getBalance(account);
        const formattedBalance = ethers.utils.formatEther(balance);
        
        // Update UI
        gameState.walletConnected = true;
        gameState.walletAddress = account;
        gameState.balance = parseFloat(formattedBalance);
        
        addressEl.textContent = `${account.slice(0, 6)}...${account.slice(-4)}`;
        balanceEl.textContent = `Bakiye: ${parseFloat(formattedBalance).toFixed(4)} AVAX`;
        walletInfo.classList.add('connected');
        
        connectBtn.querySelector('.btn-text').textContent = '✓ Bağlandı';
        connectBtn.style.background = 'linear-gradient(135deg, #4caf50, #8bc34a)';
        statusEl.textContent = '';
        
        // Listen for account changes
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);
        
        updateStartButton();
        
    } catch (error) {
        console.error('Wallet connection error:', error);
        statusEl.textContent = error.message || 'Bağlantı hatası oluştu';
        connectBtn.querySelector('.btn-text').textContent = 'MetaMask ile Bağlan';
    } finally {
        connectBtn.classList.remove('loading');
    }
}

async function switchToAvalancheFuji() {
    try {
        // Try to switch to the network
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: AVALANCHE_FUJI_CONFIG.chainId }]
        });
    } catch (switchError) {
        // If the network doesn't exist, add it
        if (switchError.code === 4902) {
            try {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [AVALANCHE_FUJI_CONFIG]
                });
            } catch (addError) {
                throw new Error('Avalanche Fuji ağı eklenemedi');
            }
        } else {
            throw switchError;
        }
    }
}

function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        // User disconnected
        gameState.walletConnected = false;
        gameState.walletAddress = null;
        
        document.getElementById('walletInfo').classList.remove('connected');
        document.getElementById('connectWallet').querySelector('.btn-text').textContent = 'MetaMask ile Bağlan';
        document.getElementById('connectWallet').style.background = 'linear-gradient(135deg, #e84142, #ff6b6b)';
        
        updateStartButton();
    } else {
        // Account changed, reconnect
        connectWallet();
    }
}

function handleChainChanged(chainId) {
    // Reload the page on chain change
    window.location.reload();
}

// Get AVAX from faucet info
function showFaucetInfo() {
    alert('Test AVAX almak için:\nhttps://faucet.avax.network/ adresini ziyaret edin\nve cüzdan adresinizi girin.');
}

// Disconnect wallet
function disconnectWallet() {
    gameState.walletConnected = false;
    gameState.walletAddress = null;
    gameState.balance = 0;
    
    document.getElementById('walletInfo').classList.remove('connected');
    document.getElementById('connectWallet').querySelector('.btn-text').textContent = 'MetaMask ile Bağlan';
    document.getElementById('connectWallet').style.background = 'linear-gradient(135deg, #e84142, #ff6b6b)';
    
    updateStartButton();
}

// Export for use in game
window.walletUtils = {
    connectWallet,
    disconnectWallet,
    switchToAvalancheFuji,
    showFaucetInfo,
    AVALANCHE_FUJI_CONFIG
};
