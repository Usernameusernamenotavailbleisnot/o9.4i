const { Web3 } = require('web3');
const { ethers } = require('ethers');
const fs = require('fs').promises;
const axios = require('axios');
const chalk = require('chalk');
const cliProgress = require('cli-progress');
const {HttpsProxyAgent} = require('https-proxy-agent');
const ora = require('ora');
const path = require('path');
const crypto = require('crypto');
const _ = require('lodash');
const yaml = require('js-yaml');

// Import modules from src directory
const NFTManager = require('./src/nft_manager');
const ContractDeployer = require('./src/deploy_contract');
const ERC20TokenDeployer = require('./src/erc20_token');
const TokenSwapper = require('./src/token_swapper');

// Default configuration
const DEFAULT_CONFIG = {
    "enable_faucet": true,
    "enable_transfer": true,
    "enable_storage": true,
    "gas_price_multiplier": 1.1,
    "max_retries": 5,
    "base_wait_time": 10,
    "transfer_amount_percentage": 90,
    "storage_network": "turbo",
    "storage_config": {
        "min_files": 5,
        "max_files": 10
    }
};

// Load configuration from YAML or JSON
async function loadConfig() {
    try {
        // Try to load JSON config
        const jsonExists = await fs.access('config.json').then(() => true).catch(() => false);
        if (jsonExists) {
            console.log(chalk.green(`${getTimestamp()} ✓ Found config.json`));
            const jsonContent = await fs.readFile('config.json', 'utf8');
            return JSON.parse(jsonContent);
        }
        
        console.log(chalk.yellow(`${getTimestamp()} ⚠ No configuration file found, using defaults`));
        return DEFAULT_CONFIG;
    } catch (error) {
        console.log(chalk.red(`${getTimestamp()} ✗ Error loading configuration: ${error.message}`));
        return DEFAULT_CONFIG;
    }
}


function getTimestamp(walletNum = null) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    if (walletNum !== null) {
        return `[${timestamp} - Wallet ${walletNum}]`;
    }
    return `[${timestamp}]`;
}

function generateRandomFile() {
    const filename = crypto.randomBytes(15).toString('hex') + '.jpeg';
    const size = Math.floor(Math.random() * (200 - 10 + 1)) + 10;
    const content = crypto.randomBytes(size).toString('base64');
    
    return { filename, content };
}

class StorageUploader {
    constructor(account, network = 'turbo') {
        this.network = network;
        this.rpcUrl = "https://evmrpc-testnet.0g.ai";
        this.account = account;
        
        this.contractAddresses = {
            'standard': '0x0460aA47b41a66694c0a73f667a1b795A5ED3556',
            'turbo': '0xbD2C3F0E65eDF5582141C35969d66e34629cC768'
        };

        this.storageApiUrls = {
            'standard': 'https://indexer-storage-testnet-standard.0g.ai',
            'turbo': 'https://indexer-storage-testnet-turbo.0g.ai'
        };
        
        // Updated Web3 initialization
        this.web3 = new Web3(this.rpcUrl);
        console.log(chalk.green(`${getTimestamp()} ✓ Connected to storage network`));
    }

    calculateStorageFee(fileSize) {
        return this.web3.utils.toWei('0.00001', 'ether');
    }

    async encodeSubmission(fileContent) {
        const fileSize = Buffer.from(fileContent).length;
        const fileHash = crypto.createHash('sha256').update(fileContent).digest();
        
        const abi = [{
            "inputs": [{
                "components": [{
                    "name": "size",
                    "type": "uint256"
                }, {
                    "name": "tags",
                    "type": "bytes"
                }, {
                    "components": [{
                        "name": "hash",
                        "type": "bytes32"
                    }, {
                        "name": "size",
                        "type": "uint256"
                    }],
                    "name": "chunks",
                    "type": "tuple[]"
                }],
                "name": "submission",
                "type": "tuple"
            }],
            "name": "submit",
            "outputs": [],
            "stateMutability": "payable",
            "type": "function"
        }];

        const contract = new this.web3.eth.Contract(abi);
        
        const submission = [
            fileSize,
            "0x",
            [[fileHash, 0]]
        ];
        
        const data = contract.methods.submit(submission).encodeABI();
        return { data, fileHash };
    }

    async uploadToStorageNode(fileContent, rootHash) {
        try {
            const fileContentB64 = Buffer.from(fileContent).toString('base64');
            
            const uploadData = {
                "root": rootHash,
                "index": 0,
                "data": fileContentB64,
                "proof": []
            };
            
            const storageUrl = `${this.storageApiUrls[this.network]}/file/segment`;
            const response = await axios.post(storageUrl, uploadData, { timeout: 120000 });
            
            if (response.status !== 200) {
                console.log(chalk.red(`${getTimestamp()} ✗ Storage node upload failed: ${response.data}`));
                return false;
            }
            
            return true;
        } catch (error) {
            console.log(chalk.red(`${getTimestamp()} ✗ Error uploading to storage node: ${error.message}`));
            return false;
        }
    }

    async uploadFile(fileContent) {
        const spinner = ora('Starting upload process...').start();
        
        try {
            const fileSize = Buffer.from(fileContent).length;
            spinner.text = `File size: ${fileSize} bytes`;
            
            const contractAddress = this.contractAddresses[this.network];
            spinner.text = `Using contract: ${contractAddress}`;
            
            const { data, fileHash } = await this.encodeSubmission(fileContent);
            const rootHash = "0x" + fileHash.toString('hex');
            spinner.text = `Root hash: ${rootHash}`;
            
            const storageFee = this.calculateStorageFee(fileSize);
            spinner.text = `Storage fee: ${this.web3.utils.fromWei(storageFee, 'ether')} A0GI`;
            
            const nonce = await this.web3.eth.getTransactionCount(this.account.address);
            const gasPrice = await this.web3.eth.getGasPrice();
            
            const transaction = {
                from: this.account.address,
                to: contractAddress,
                value: storageFee,
                gas: 500000,
                gasPrice: gasPrice,
                nonce: nonce,
                data: data,
                chainId: await this.web3.eth.getChainId()
            };
            
            const signedTxn = await this.web3.eth.accounts.signTransaction(transaction, this.account.privateKey);
            spinner.text = 'Transaction signed';
            
            const txHash = await this.web3.eth.sendSignedTransaction(signedTxn.rawTransaction);
            spinner.text = `Transaction sent. Hash: ${txHash.transactionHash}`;
            
            const txReceipt = await this.web3.eth.getTransactionReceipt(txHash.transactionHash);
            spinner.text = `Transaction confirmed in block ${txReceipt.blockNumber}`;
            
            if (txReceipt.status) {
                spinner.text = 'Transaction successful! Uploading to storage node...';
                
                if (await this.uploadToStorageNode(fileContent, rootHash)) {
                    spinner.succeed('Storage node upload successful!');
                } else {
                    spinner.fail('Storage node upload failed!');
                }
                
                return {
                    success: true,
                    txHash: txHash.transactionHash,
                    rootHash: rootHash
                };
            } else {
                throw new Error("Transaction failed");
            }
            
        } catch (error) {
            spinner.fail(`Error details: ${error.message}`);
            throw error;
        }
    }
}

class EnhancedFaucetClaimer {
    constructor(scrappeyApiKey, config = {}) {
        this.scrappeyApiKey = scrappeyApiKey;
        this.scrappeyUrl = 'https://publisher.scrappey.com/api/v1';
        this.faucetUrl = 'https://992dkn4ph6.execute-api.us-west-1.amazonaws.com/';
        this.web3 = new Web3('https://evmrpc-testnet.0g.ai');
        // Set default config first
        this.config = DEFAULT_CONFIG;
        this.maxRetries = DEFAULT_CONFIG.max_retries;
        this.baseWaitTime = DEFAULT_CONFIG.base_wait_time;
        // Merge with provided config
        if (config) {
            this.config = { ...DEFAULT_CONFIG, ...config };
            this.maxRetries = this.config.max_retries;
            this.baseWaitTime = this.config.base_wait_time;
        }
        // Other initializations
        this.proxies = [];
        this.currentProxy = null;
        this.retryCodes = new Set([408, 429, 500, 502, 503, 504]);
        this.currentWalletNum = 0;
    }

    async initialize() {
        // Load proxies after construction
        this.proxies = await this.loadProxies();
        return this;
    }

    async loadProxies() {
        try {
            const proxyFile = await fs.readFile('proxy.txt', 'utf8');
            const proxies = proxyFile.split('\n').map(line => line.trim()).filter(line => line);
            console.log(chalk.green(`${getTimestamp()} ✓ Successfully loaded proxies`));
            return proxies;
        } catch (error) {
            console.log(chalk.yellow(`${getTimestamp()} ⚠ proxy.txt not found, will use default Scrappey proxy`));
            return [];
        }
    }

    getRandomProxy() {
        if (this.proxies.length > 0) {
            this.currentProxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
            return this.currentProxy;
        }
        return null;
    }

    getProxiesDict() {
        if (this.currentProxy) {
            if (this.currentProxy.startsWith('http')) {
                return {
                    'http': this.currentProxy,
                    'https': this.currentProxy
                };
            }
            return {
                'http': `http://${this.currentProxy}`,
                'https': `http://${this.currentProxy}`
            };
        }
        return null;
    }

    exponentialBackoff(attempt) {
        const waitTime = Math.min(300, this.baseWaitTime * (2 ** attempt));
        const jitter = 0.5 + Math.random();
        return Math.floor(waitTime * jitter);
    }

    async makeRequestWithRetry(method, url, options = {}) {
        let attempt = 0;
        
        // Handle proxy configuration
        if (url !== this.scrappeyUrl && this.currentProxy) {
            // Create proxy agent
            const proxyUrl = this.currentProxy.startsWith('http') ? 
                this.currentProxy : 
                `http://${this.currentProxy}`;
            
            const httpsAgent = new HttpsProxyAgent(proxyUrl);
            options.httpsAgent = httpsAgent;
            options.proxy = false; // Disable axios proxy handling
        }
        
        // Set appropriate timeout
        if (url === this.faucetUrl) {
            options.timeout = 180000; // 3 minutes for faucet
        } else if (!options.timeout) {
            options.timeout = 30000;
        }
        
        while (attempt < this.maxRetries) {
            try {
                const response = await axios({
                    method,
                    url,
                    ...options,
                    validateStatus: null // Don't throw error on any status
                });
                
                // For faucet requests, show response regardless of status
                if (url === this.faucetUrl) {
                    console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} Server response:`), 
                        typeof response.data === 'object' ? JSON.stringify(response.data) : response.data);
                    
                    if (response.status >= 200 && response.status < 300) {
                        return { response, success: true };
                    }
                }
                
                // For other requests, check status code
                if (!this.retryCodes.has(response.status)) {
                    return { response, success: true };
                }
                
                const waitTime = this.exponentialBackoff(attempt);
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Got status ${response.status}, retrying in ${waitTime}s...`));
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                
                if (url !== this.scrappeyUrl) {
                    this.getRandomProxy();
                    // Update proxy agent if proxy changed
                    if (this.currentProxy) {
                        const newProxyUrl = this.currentProxy.startsWith('http') ? 
                            this.currentProxy : 
                            `http://${this.currentProxy}`;
                        options.httpsAgent = new HttpsProxyAgent(newProxyUrl);
                    }
                }
                
            } catch (error) {
                const waitTime = this.exponentialBackoff(attempt);
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Request error: ${error.message}`));
                
                if (error.response) {
                    console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} Server response:`),
                        typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data);
                }
                
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Retrying in ${waitTime}s...`));
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                
                if (url !== this.scrappeyUrl) {
                    this.getRandomProxy();
                    // Update proxy agent if proxy changed
                    if (this.currentProxy) {
                        const newProxyUrl = this.currentProxy.startsWith('http') ? 
                            this.currentProxy : 
                            `http://${this.currentProxy}`;
                        options.httpsAgent = new HttpsProxyAgent(newProxyUrl);
                    }
                }
            }
            
            attempt++;
        }
        
        return { response: null, success: false };
    }

    getAddressFromPk(privateKey) {
        try {
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }
            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            return account.address;
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error generating address: ${error.message}`));
            return null;
        }
    }

    async solveHcaptcha() {
        console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} Solving hCaptcha with direct sitekey method...`));
        
        const headers = {
            'Content-Type': 'application/json'
        };
        
        const params = {
            'key': this.scrappeyApiKey
        };
        
        const proxy = this.getRandomProxy();
        
        // Using the simplified direct sitekey approach from documentation
        const jsonData = {
            'cmd': 'request.get',
            'url': 'https://hub.0g.ai',
            'dontLoadMainSite': true,
            'filter': [
                'javascriptReturn'
            ],
            'browserActions': [
                {
                    'type': 'solve_captcha',
                    'captcha': 'hcaptcha',
                    'captchaData': {
                        'sitekey': '1230eb62-f50c-4da4-a736-da5c3c342e8e'
                    }
                }
            ]
        };
        
        if (proxy) {
            jsonData.proxy = proxy;
        }
        
        try {
            const { response, success } = await this.makeRequestWithRetry(
                'POST',
                this.scrappeyUrl,
                {
                    params,
                    headers,
                    data: jsonData,
                    timeout: 120000
                }
            );
            
            if (!success || !response) {
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Failed to solve captcha after all retries`));
                return null;
            }
            
            if (response.status === 200) {
                const result = response.data;
                
                console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} ℹ Captcha response received`));
                
                // The token should be directly in javascriptReturn based on this method
                if (result.solution && result.solution.javascriptReturn && 
                    Array.isArray(result.solution.javascriptReturn) && 
                    result.solution.javascriptReturn.length > 0) {
                    
                    const captchaToken = result.solution.javascriptReturn[0];
                    
                    if (captchaToken && typeof captchaToken === 'string' && captchaToken.length > 20) {
                        console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Successfully obtained captcha token`));
                        console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} ℹ Token starts with: ${captchaToken.substring(0, 15)}...`));
                        return captchaToken;
                    } else {
                        console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠️ Token in javascriptReturn appears invalid:`, captchaToken));
                    }
                }
                
                // Fallback checks for token in other possible locations
                if (result.solution && result.solution.token) {
                    console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Found token in solution.token`));
                    return result.solution.token;
                }
                
                if (result.token) {
                    console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Found token directly in result.token`));
                    return result.token;
                }
                
                // Log the response structure for debugging
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠️ Could not find token in expected locations. Response structure:`));
                console.log(JSON.stringify(result, null, 2));
            }
            
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Failed to get captcha solution`));
            return null;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error solving captcha: ${error.message}`));
            return null;
        }
    }

    async claimFaucet(privateKey) {
        if (!this.config.enable_faucet) {
            return true;
        }
    
        try {
            const address = this.getAddressFromPk(privateKey);
            if (!address) {
                return false;
            }
            
            // Try to solve captcha up to 3 times
            let captchaToken = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                console.log(chalk.blue(`${getTimestamp(this.currentWalletNum)} Captcha attempt ${attempt+1}/3`));
                captchaToken = await this.solveHcaptcha();
                if (captchaToken) break;
                
                if (attempt < 2) {
                    console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠️ Captcha attempt ${attempt+1} failed, waiting before retry...`));
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
            
            if (!captchaToken) {
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Failed to solve captcha after multiple attempts`));
                return false;
            }
            
            console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} Claiming faucet with valid captcha token...`));
            
            const payload = {
                "address": address,
                "hcaptchaToken": captchaToken,
                "token": "A0GI"
            };
            
            // Full set of headers matching browser request
            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                'Origin': 'https://hub.0g.ai',
                'Referer': 'https://hub.0g.ai/',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.6',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'DNT': '1',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site',
                'Priority': 'u=1, i',
                'Sec-GPC': '1',
                'Sec-Ch-Ua': '"Not(A:Brand";v="99", "Brave";v="133", "Chromium";v="133"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"'
            };
            
            console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} ℹ Making faucet request for address: ${address}`));
            
            const { response, success } = await this.makeRequestWithRetry('POST', this.faucetUrl, {
                headers,
                data: payload
            });
            
            if (!success || !response) {
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ No response from faucet request`));
                return false;
            }
            
            const responseData = response.data;
            
            // Skip detailed logging here since makeRequestWithRetry already logs the server response
            
            // Handle possible responses
            if (responseData.message && responseData.message.includes("Invalid Captcha")) {
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Invalid captcha response received`));
                return false;  // Return false to allow retry
            } else if (responseData.message && (responseData.message.includes('hours') || responseData.message.includes('hour') || responseData.message.includes('wait'))) {
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Rate limited: ${responseData.message}`));
                return true;  // Return True to skip retries and move to next task
            } else if (responseData.message && (responseData.message.includes('hash:') || responseData.message.startsWith('0x'))) {
                const txHash = responseData.message.includes('hash:') ? 
                    responseData.message.split('hash:')[1].trim() : 
                    responseData.message;
                    
                console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Success! Transaction: https://chainscan-newton.0g.ai/tx/${txHash}`));
                return true;
            } else {
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Unexpected response: ${responseData.message || 'Unknown error'}`));
                return false;
            }
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error claiming faucet: ${error.message}`));
            return false;
        }
    }

    async transferToSelf(privateKey) {
        if (!this.config.enable_transfer) {
            return true;
        }

        console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} Transferring A0GI to self...`));
        try {
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }

            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            const balance = BigInt(await this.web3.eth.getBalance(account.address));
            
            if (balance === BigInt(0)) {
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ No balance to transfer`));
                return true;
            }

            // Get current gas price and apply multiplier
            const gasPrice = BigInt(await this.web3.eth.getGasPrice());
            const adjustedGasPrice = gasPrice * BigInt(Math.floor(this.config.gas_price_multiplier * 100)) / BigInt(100);
            
            const transaction = {
                nonce: await this.web3.eth.getTransactionCount(account.address),
                to: account.address,
                from: account.address,
                data: '0x',
                chainId: 16600,
                gas: '21000',
                gasPrice: adjustedGasPrice.toString()
            };

            // Calculate gas cost and transfer amount
            const gasCost = BigInt(transaction.gas) * adjustedGasPrice;
            const transferPercentage = BigInt(this.config.transfer_amount_percentage);
            const transferAmount = (balance * transferPercentage / BigInt(100)) - gasCost;

            if (transferAmount <= 0) {
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Balance too low to cover gas`));
                return true;
            }
            
            transaction.value = transferAmount.toString();

            // Sign and send transaction
            const signed = await this.web3.eth.accounts.signTransaction(transaction, privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signed.rawTransaction);
            
            console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Transfer successful: ${receipt.transactionHash}`));
            return true;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error transferring: ${error.message}`));
            return false;
        }
    }

    async uploadRandomFiles(privateKey) {
        if (!this.config.enable_storage) {
            return true;
        }

        try {
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }

            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            const uploader = new StorageUploader(account, this.config.storage_network);
            
            // Get the min and max files from config, with fallback to default values
            const storageConfig = this.config.storage_config || { min_files: 5, max_files: 10 };
            const minFiles = Math.min(storageConfig.min_files || 5, storageConfig.max_files || 10);
            const numFiles = Math.floor(Math.random() * (storageConfig.max_files - minFiles + 1)) + minFiles;
            
            console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} Uploading ${numFiles} random files...`));
            
            for (let i = 0; i < numFiles; i++) {
                const { filename, content } = generateRandomFile();
                console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} ℹ Generated file ${i+1}/${numFiles}: ${filename}`));
                
                try {
                    const result = await uploader.uploadFile(content);
                    if (result && result.success) {
                        console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Upload completed!`));
                        console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Transaction hash: ${result.txHash}`));
                        console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Root hash: ${result.rootHash}`));
                    } else {
                        console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Upload failed`));
                        return false;
                    }
                } catch (error) {
                    console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error during upload: ${error.message}`));
                    return false;
                }
                
                if (i < numFiles - 1) {
                    const waitTime = Math.random() * 9 + 1; // Random wait between 1-10 seconds
                    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                }
            }
            
            return true;
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error in upload process: ${error.message}`));
            return false;
        }
    }

    async processWallet(privateKey) {
        const steps = [
            [this.claimFaucet.bind(this), "enable_faucet", "Claiming faucet"],
            [this.transferToSelf.bind(this), "enable_transfer", "Transferring A0GI"],
            [this.uploadRandomFiles.bind(this), "enable_storage", "Uploading random files"]
        ];

        for (const [stepFunc, configKey, stepName] of steps) {
            if (this.config[configKey]) {
                let attempt = 0;
                while (attempt < this.maxRetries) {
                    console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} ${stepName}... (Attempt ${attempt + 1}/${this.maxRetries})`));
                    if (await stepFunc(privateKey)) {
                        break;
                    }
                    attempt++;
                    if (attempt < this.maxRetries) {
                        const waitTime = this.exponentialBackoff(attempt);
                        console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} Waiting ${waitTime} seconds before retry...`));
                        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                    }
                }
                if (attempt === this.maxRetries) {
                    return false;
                }
            }
        }
        return true;
    }
}

async function countdownTimer(hours = 25) {
    const totalSeconds = hours * 3600;
    let remainingSeconds = totalSeconds;

    while (remainingSeconds > 0) {
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;

        // Clear previous line and update countdown
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(
            chalk.blue(`${getTimestamp()} Next cycle in: `) + 
            chalk.yellow(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`)
        );

        await new Promise(resolve => setTimeout(resolve, 1000));
        remainingSeconds--;
    }

    // Clear the countdown line
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    console.log(chalk.green(`${getTimestamp()} ✓ Countdown completed!`));
}

async function main() {
    while (true) {
        console.log(chalk.blue.bold('\n=== 0g.ai - Next JP ===\n'));

        try {
            // Load configuration (JSON only now)
            const config = await loadConfig();
            console.log(chalk.green(`${getTimestamp()} ✓ Configuration loaded`));
            
            // Rest of the code remains the same
            const privateKeys = (await fs.readFile('pk.txt', 'utf8'))
                .split('\n')
                .map(line => line.trim())
                .filter(line => line);

            console.log(chalk.green(`${getTimestamp()} ✓ Found ${privateKeys.length} private keys`));

            const scrappeyApiKey = "";
            console.log(chalk.blue.bold(`${getTimestamp()} Initializing automation...`));

            // Create and initialize the claimer with loaded config
            const claimer = await new EnhancedFaucetClaimer(scrappeyApiKey, config).initialize();

            // Process wallets
            console.log(chalk.blue.bold(`\nProcessing ${privateKeys.length} wallets...\n`));

            for (let i = 0; i < privateKeys.length; i++) {
                claimer.currentWalletNum = i + 1;
                const pk = privateKeys[i];

                console.log(chalk.blue.bold(`\n=== Processing Wallet ${i + 1}/${privateKeys.length} ===\n`));

                const proxy = claimer.getRandomProxy();
                if (proxy) {
                    console.log(chalk.cyan(`${getTimestamp(i + 1)} ℹ Using proxy: ${proxy}`));
                }

                const address = claimer.getAddressFromPk(pk);
                if (address) {
                    console.log(chalk.green(`${getTimestamp(i + 1)} ✓ Processing address: ${address}`));

                    // Process standard wallet operations (faucet, transfer, storage)
                    const standardSuccess = await claimer.processWallet(pk);
                    if (!standardSuccess) {
                        console.log(chalk.red(`${getTimestamp(i + 1)} ✗ Failed to process standard operations completely`));
                    }
                    
                    // Process token operations (faucets and swaps)
                    try {
                        console.log(chalk.blue.bold(`\n=== Running Token Operations for Wallet ${i + 1} ===\n`));
                        
                        // Initialize token swapper with wallet's private key and current config
                        const tokenSwapper = new TokenSwapper(pk, config.token_operations || {});
                        tokenSwapper.setWalletNum(i + 1);
                        
                        // Execute token operations (claim faucets, perform swaps)
                        await tokenSwapper.executeTokenOperations();
                        
                    } catch (error) {
                        console.log(chalk.red(`${getTimestamp(i + 1)} ✗ Error in token operations: ${error.message}`));
                    }
                    
                    // Process contract operations (new module)
                    try {
                        console.log(chalk.blue.bold(`\n=== Running Contract Operations for Wallet ${i + 1} ===\n`));
                        
                        // Initialize contract deployer with wallet's private key and current config
                        const contractDeployer = new ContractDeployer(pk, config.contract || {});
                        contractDeployer.setWalletNum(i + 1);
                        
                        // Execute contract operations (compile, deploy, interact)
                        await contractDeployer.executeContractOperations();
                        
                    } catch (error) {
                        console.log(chalk.red(`${getTimestamp(i + 1)} ✗ Error in contract operations: ${error.message}`));
                    }
                    
                    // Process ERC20 token operations
                    try {
                        console.log(chalk.blue.bold(`\n=== Running ERC20 Token Operations for Wallet ${i + 1} ===\n`));
                        
                        // Initialize ERC20 token deployer with wallet's private key and current config
                        const erc20Deployer = new ERC20TokenDeployer(pk, config);
                        erc20Deployer.setWalletNum(i + 1);
                        
                        // Execute ERC20 token operations (compile, deploy, mint, burn)
                        await erc20Deployer.executeTokenOperations();
                        
                    } catch (error) {
                        console.log(chalk.red(`${getTimestamp(i + 1)} ✗ Error in ERC20 token operations: ${error.message}`));
                    }
                    
                    // Process NFT operations
                    try {
                        console.log(chalk.blue.bold(`\n=== Running NFT Operations for Wallet ${i + 1} ===\n`));
                        
                        // Initialize NFT manager with wallet's private key and current config
                        const nftManager = new NFTManager(pk, config);
                        nftManager.setWalletNum(i + 1);
                        
                        // Execute NFT operations (compile, deploy, mint, burn)
                        await nftManager.executeNFTOperations();
                        
                    } catch (error) {
                        console.log(chalk.red(`${getTimestamp(i + 1)} ✗ Error in NFT operations: ${error.message}`));
                    }
                }

                if (i < privateKeys.length - 1) {
                    const waitTime = Math.floor(Math.random() * 11) + 5; // 5-15 seconds
                    console.log(chalk.yellow(`\n${getTimestamp(i + 1)} Waiting ${waitTime} seconds before next wallet...\n`));
                    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                }
            }

            console.log(chalk.green.bold('\nWallet processing completed! Starting 25-hour countdown...\n'));

            // Start the 25-hour countdown
            await countdownTimer(25);

        } catch (error) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    }
}

main().catch(console.error);
