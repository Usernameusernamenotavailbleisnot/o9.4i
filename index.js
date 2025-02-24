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

// Default configuration
const DEFAULT_CONFIG = {
    "enable_faucet": true,
    "enable_contract_deploy": true,
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

const SIMPLE_CONTRACT_BYTECODE = "608060405234801561001057600080fd5b50610150806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c806360fe47b11461003b5780636d4ce63c14610057575b600080fd5b610055600480360381019061005091906100c3565b610075565b005b61005f61007f565b60405161006c91906100ff565b60405180910390f35b8060008190555050565b60008054905090565b600080fd5b6000819050919050565b6100a08161008d565b81146100ab57600080fd5b50565b6000813590506100bd81610097565b92915050565b6000602082840312156100d9576100d8610088565b5b60006100e7848285016100ae565b91505092915050565b6100f98161008d565b82525050565b600060208201905061011460008301846100f0565b9291505056fe";

const SIMPLE_ERC20_BYTECODE = "60806040526012600560006101000a81548160ff021916908360ff1602179055503480156200002d57600080fd5b506040518060400160405280600481526020017f544553540000000000000000000000000000000000000000000000000000000081525060409051806040016040528060048152602001600481525081600390805190602001906200009592919062000149565b508060049080519060200190620000ae92919062000149565b50505062000248565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10620000f057805160ff191683800117855562000121565b8280016001018555821562000121579182015b828111156200012057825182559160200191906001019062000103565b5b50905062000130919062000134565b5090565b5b808211156200014557600081600090555060010162000135565b5090565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106200018c57805160ff1916838001178555620001bd565b82800160010185558215620001bd579182015b82811115620001bc578251825591602001919060010190620001a0565b5b509050620001cc9190620001d0565b5090565b5b80821115620001eb576000816000905550600101620001d1565b5090565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b60006002820490506001821680620002735760006000905092915050565b6000819050919050565b600060028204905060018216806200029657600080905092915050565b6000819050919050565b6000620002ad82620002a3565b915062000281565b6000620002c082620002a3565b9150620002cd83620002a3565b925082620002e057620002df620002d1565b5b828204905092915050565b6000620002f882620002a3565b91506200030583620002a3565b9250827fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff038211156200033d576200033c620002d1565b5b828201905092915050565b600082825260208201905092915050565b600081905092915050565b600082825260208201905092915050565b60005b838110156200039457808201518184015260208101905062000377565b60008484015250505050565b6000620003ad826200035d565b620003b981856200036d565b9350620003cb81856020860162000378565b80840191505092915050565b6000620003e582846200039f565b915081905092915050565b6000620003fd826200035d565b6200040981856200034d565b93506200041b81856020860162000378565b6200042681620003a0565b840191505092915050565b6000602082019050818103600083015262000452818462000440565b905092915050565b600060208284031215620004725762000471620004be565b5b600062000482848285016200046c565b91505092915050565b60006200049782620004a8565b9050919050565b60008115159050919050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b600080fd5b6000819050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b6200051c81620004e9565b81146200052857600080fd5b50565b60006200053b82620004e9565b91506200054883620004e9565b925082821015620005615762000560620004fa565b5b828203905092915050565b600062000579826200035d565b6200058581856200034d565b93506200059781856020860162000378565b620005a281620003a0565b840191505092915050565b60006020820190508181036000830152620005c981846200056c565b905092915050565b600062000643905600a265627a7a72305820f9c5da1da" + "0".repeat(40);

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
    constructor(scrappeyApiKey) {
        this.scrappeyApiKey = scrappeyApiKey;
        this.scrappeyUrl = 'https://publisher.scrappey.com/api/v1';
        this.faucetUrl = 'https://faucet.0g.ai/api/faucet';
        this.web3 = new Web3('https://evmrpc-testnet.0g.ai');
        // Set default config first
        this.config = DEFAULT_CONFIG;
        this.maxRetries = DEFAULT_CONFIG.max_retries;
        this.baseWaitTime = DEFAULT_CONFIG.base_wait_time;
        // Other initializations
        this.proxies = [];
        this.currentProxy = null;
        this.retryCodes = new Set([408, 429, 500, 502, 503, 504]);
        this.currentWalletNum = 0;
    }

    async initialize() {
        // Load config and proxies after construction
        await this.loadConfig();
        this.proxies = await this.loadProxies();
        // Update values from loaded config
        this.maxRetries = this.config.max_retries;
        this.baseWaitTime = this.config.base_wait_time;
        return this;
    }

    async loadConfig() {
        try {
            const configFile = await fs.readFile('config.json', 'utf8');
            this.config = { ...DEFAULT_CONFIG, ...JSON.parse(configFile) };
        } catch (error) {
            console.log(chalk.yellow(`${getTimestamp()} ⚠ config.json not found, using default configuration`));
            this.config = DEFAULT_CONFIG;
        }
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
        console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} Solving hCaptcha...`));
        
        const headers = {
            'Content-Type': 'application/json',
        };
        
        const params = {
            'key': this.scrappeyApiKey,
        };
        
        const proxy = this.getRandomProxy();
        
        const jsonData = {
            'cmd': 'request.get',
            'url': 'https://faucet.0g.ai',
            'dontLoadMainSite': true,
            'filter': ['javascriptReturn'],
            'browserActions': [{
                'type': 'solve_captcha',
                'captcha': 'hcaptcha',
                'captchaData': {
                    'sitekey': '914e63b4-ac20-4c24-bc92-cdb6950ccfde',
                },
            }],
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
                if (result.solution && result.solution.javascriptReturn) {
                    const captchaToken = result.solution.javascriptReturn[0];
                    console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Successfully got captcha solution`));
                    return captchaToken;
                }
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
            
            const captchaToken = await this.solveHcaptcha();
            if (!captchaToken) {
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Failed to solve captcha`));
                return false;
            }
            
            console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} Claiming faucet...`));
            
            const payload = {
                "address": address,
                "hcaptchaToken": captchaToken
            };
            
            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
                'Origin': 'https://faucet.0g.ai',
                'Referer': 'https://faucet.0g.ai/'
            };
            
            const { response, success } = await this.makeRequestWithRetry('POST', this.faucetUrl, {
                headers,
                data: payload
            });
            
            if (!success || !response) return false;
            
            const responseData = response.data;
            
            // Check for cooldown message
            if (responseData.message && (responseData.message.includes('hours') || responseData.message.includes('hour'))) {
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ ${responseData.message}`));
                return true;  // Return True to skip retries and move to next task
            }
            
            // If it's a success (contains transaction hash)
            if (responseData.message && (responseData.message.includes('hash:') || responseData.message.startsWith('0x'))) {
                const txHash = responseData.message.includes('hash:') ? 
                    responseData.message.split('hash:')[1].trim() : 
                    responseData.message;
                    
                console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Success: https://chainscan-newton.0g.ai/tx/${txHash}`));
                return true;
            }
            
            // For other errors
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ ${responseData.message || 'Unknown error'}`));
            return false;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error claiming faucet: ${error.message}`));
            return false;
        }
    }

    async deployContract(privateKey) {
        if (!this.config.enable_contract_deploy) {
            return true;
        }

        console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} Deploying random contract...`));
        try {
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }

            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            const nonce = await this.web3.eth.getTransactionCount(account.address);

            // Add 0x prefix to bytecode if not present
            const bytecode = SIMPLE_CONTRACT_BYTECODE.startsWith('0x') ? 
                SIMPLE_CONTRACT_BYTECODE : 
                '0x' + SIMPLE_CONTRACT_BYTECODE;

            // Convert gas price to BigInt and calculate
            const gasPrice = BigInt(await this.web3.eth.getGasPrice());
            const adjustedGasPrice = gasPrice * BigInt(Math.floor(this.config.gas_price_multiplier * 100)) / BigInt(100);

            const transaction = {
                nonce: nonce,
                from: account.address,
                to: null,
                value: '0',
                data: bytecode,
                chainId: 16600,
                gasPrice: adjustedGasPrice.toString()
            };

            // Estimate gas and set with buffer
            const estimatedGas = await this.web3.eth.estimateGas(transaction);
            transaction.gas = Math.floor(Number(estimatedGas) * 1.1).toString();

            // Sign the transaction
            const signed = await this.web3.eth.accounts.signTransaction(transaction, privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signed.rawTransaction);
            
            console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Contract deployed at: ${receipt.contractAddress}`));
            console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Transaction hash: ${receipt.transactionHash}`));
            return true;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error deploying contract: ${error.message}`));
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
            [this.deployContract.bind(this), "enable_contract_deploy", "Deploying contract"],
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
            const privateKeys = (await fs.readFile('pk.txt', 'utf8'))
                .split('\n')
                .map(line => line.trim())
                .filter(line => line);

            console.log(chalk.green(`${getTimestamp()} ✓ Found ${privateKeys.length} private keys`));

            const scrappeyApiKey = "";
            console.log(chalk.blue.bold(`${getTimestamp()} Initializing automation...`));

            // Create and initialize the claimer
            const claimer = await new EnhancedFaucetClaimer(scrappeyApiKey).initialize();

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

                    const success = await claimer.processWallet(pk);
                    if (!success) {
                        console.log(chalk.red(`${getTimestamp(i + 1)} ✗ Failed to process wallet completely`));
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
