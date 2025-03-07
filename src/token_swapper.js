const { Web3 } = require('web3');
const chalk = require('chalk');
const ora = require('ora');

function getTimestamp(walletNum = null) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    if (walletNum !== null) {
        return `[${timestamp} - Wallet ${walletNum}]`;
    }
    return `[${timestamp}]`;
}

class TokenSwapper {
    constructor(privateKey, config = {}) {
        // Default configuration
        this.defaultConfig = {
            enable_onchain_faucet: true,
            enable_token_swap: true,
            faucet_tokens: ["USDT", "BTC", "ETH"],
            swap_pairs: [
                { from: "USDT", to: "BTC", count: 2 },
                { from: "USDT", to: "ETH", count: 2 },
                { from: "BTC", to: "USDT", count: 1 },
                { from: "ETH", to: "USDT", count: 1 }
            ],
            // Default amounts in normal decimal format
            swap_amounts: {
                "USDT": {
                    min: 0.01,
                    max: 0.1
                },
                "BTC": {
                    min: 0.000001,
                    max: 0.00001
                },
                "ETH": {
                    min: 0.00001,
                    max: 0.0001
                }
            },
            // Default decimal precision for each token
            decimal_precision: {
                "USDT": 4,
                "BTC": 6,
                "ETH": 5
            },
            default_gas: 100000, // Lower default gas as fallback
            max_retries: 3,
            // NEW: Gas price configuration
            gas_price: {
                multiplier: 1.2,      // Multiplier for network gas price
                retry_increase: 1.3,  // Increase by this factor on each retry
                min_gwei: 0,          // Minimum gas price in gwei
                max_gwei: 200         // Maximum gas price in gwei
            },
            // NEW: Options for mempool handling
            mempool_options: {
                retry_delay_base: 5000,        // Base delay in ms (5 seconds)
                retry_delay_extra: 5000,       // Random extra delay up to this amount
                mempool_retry_multiplier: 3,   // Multiply delay when mempool is full
                rpc_rotation_enabled: true     // Enable RPC rotation on errors
            }
        };
        
        // Load configuration, processing the nested token_operations object if it exists
        if (config.token_operations) {
            // Extract token_operations to top level while keeping other properties
            this.config = {
                ...this.defaultConfig,
                ...config.token_operations,
                // Keep non-token_operations properties from original config
                ...Object.keys(config)
                    .filter(key => key !== 'token_operations')
                    .reduce((obj, key) => {
                        obj[key] = config[key];
                        return obj;
                    }, {})
            };
        } else {
            // Simple merge if no token_operations
            this.config = { ...this.defaultConfig, ...config };
        }
        
        // NEW: RPC endpoints with rotation
        this.rpcUrls = [
            "https://evm-rpc.0g.testnet.node75.org",
            "https://evmrpc-testnet.0g.ai",
            "https://16600.rpc.thirdweb.com",
            "https://rpc.ankr.com/0g_newton",
            "https://0g-json-rpc-public.originstake.com",
            "https://0g-evm-rpc.murphynode.net",
            "https://og-testnet-evm.itrocket.net"
        ];
        this.currentRpcIndex = 0;
        
        // RPC connection - start with first in the list
        this.rpcUrl = this.rpcUrls[this.currentRpcIndex];
        this.web3 = new Web3(this.rpcUrl);
        
        // Chain ID
        this.chainId = 16600;
        
        // Setup account
        if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
        }
        this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
        this.walletNum = null;
        
        // Add nonce tracking to avoid transaction issues
        this.currentNonce = null;
        this.pendingTransactions = 0;
        
        // NEW: Track failed transactions for potential replacement
        this.failedTransactions = [];
        
        // Token contract addresses
        this.tokenContracts = {
            "USDT": "0x9A87C2412d500343c073E5Ae5394E3bE3874F76b",
            "BTC": "0x1E0D871472973c562650E991ED8006549F8CBEfc",
            "ETH": "0xce830D0905e0f7A9b300401729761579c5FB6bd6"
        };
        
        // DEX router address
        this.dexRouter = "0xD86b764618c6E3C078845BE3c3fCe50CE9535Da7";
        
        // Function signatures
        this.functionSignatures = {
            faucet: "0x1249c58b",
            approve: "0x095ea7b3"
        };
        
        // Token decimals for conversion
        this.tokenDecimals = {
            "USDT": 18,
            "BTC": 18,
            "ETH": 18
        };
        
        // Standard ERC20 ABI for token operations
        this.erc20Abi = [
            {
                "constant": true,
                "inputs": [{"name": "_owner", "type": "address"}],
                "name": "balanceOf",
                "outputs": [{"name": "balance", "type": "uint256"}],
                "type": "function"
            },
            {
                "constant": false,
                "inputs": [
                    {"name": "_spender", "type": "address"},
                    {"name": "_value", "type": "uint256"}
                ],
                "name": "approve",
                "outputs": [{"name": "", "type": "bool"}],
                "type": "function"
            },
            {
                "constant": true,
                "inputs": [
                    {"name": "_owner", "type": "address"},
                    {"name": "_spender", "type": "address"}
                ],
                "name": "allowance",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function"
            }
        ];
    }
    
    setWalletNum(num) {
        this.walletNum = num;
    }
    
    // NEW: Rotate RPC endpoints to handle different node behaviors
    async rotateRpc() {
        if (!this.config.mempool_options.rpc_rotation_enabled) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ RPC rotation disabled in config`));
            return false;
        }
        
        // Select next RPC in the list
        this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcUrls.length;
        this.rpcUrl = this.rpcUrls[this.currentRpcIndex];
        
        console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Switching to RPC: ${this.rpcUrl}`));
        
        // Create new Web3 instance with the selected RPC
        this.web3 = new Web3(this.rpcUrl);
        
        // Reset nonce after RPC rotation to ensure correct nonce
        this.currentNonce = null;
        
        return true;
    }
    
    // ENHANCED: Improved gas price calculation with config-based multipliers
    async getGasPrice(retryCount = 0) {
        try {
            // Get the current gas price from the network
            const networkGasPrice = await this.web3.eth.getGasPrice();
            
            // Apply base multiplier from config
            let multiplier = this.config.gas_price.multiplier || 1.5;
            
            // Apply additional multiplier for retries
            if (retryCount > 0) {
                const retryMultiplier = Math.pow(this.config.gas_price.retry_increase || 1.3, retryCount);
                multiplier *= retryMultiplier;
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Applying retry multiplier: ${retryMultiplier.toFixed(2)}x (total: ${multiplier.toFixed(2)}x)`));
            }
            
            // Calculate gas price with multiplier
            const adjustedGasPrice = BigInt(Math.floor(Number(networkGasPrice) * multiplier));
            
            // Convert to gwei for display
            const gweiPrice = this.web3.utils.fromWei(adjustedGasPrice.toString(), 'gwei');
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Network gas price: ${this.web3.utils.fromWei(networkGasPrice, 'gwei')} gwei, using: ${gweiPrice} gwei (${multiplier.toFixed(2)}x)`));
            
            // Enforce min/max gas price in gwei
            const minGasPrice = BigInt(this.web3.utils.toWei(this.config.gas_price.min_gwei.toString() || '1', 'gwei'));
            const maxGasPrice = BigInt(this.web3.utils.toWei(this.config.gas_price.max_gwei.toString() || '50', 'gwei'));
            
            // Ensure gas price is within bounds
            let finalGasPrice = adjustedGasPrice;
            if (adjustedGasPrice < minGasPrice) {
                finalGasPrice = minGasPrice;
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Gas price below minimum, using: ${this.config.gas_price.min_gwei} gwei`));
            } else if (adjustedGasPrice > maxGasPrice) {
                finalGasPrice = maxGasPrice;
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Gas price above maximum, using: ${this.config.gas_price.max_gwei} gwei`));
            }
            
            return finalGasPrice.toString();
        } catch (error) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Error getting gas price: ${error.message}`));
            
            // Fallback to a low gas price
            const fallbackGasPrice = this.web3.utils.toWei(this.config.gas_price.min_gwei.toString() || '1', 'gwei');
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Using fallback gas price: ${this.config.gas_price.min_gwei} gwei`));
            
            return fallbackGasPrice;
        }
    }
    
    // Get the next nonce, considering pending transactions
    async getNonce() {
        if (this.currentNonce === null) {
            // If this is the first transaction, get the nonce from the network
            try {
                this.currentNonce = await this.web3.eth.getTransactionCount(this.account.address);
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Initial nonce from network: ${this.currentNonce}`));
            } catch (error) {
                console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error getting nonce: ${error.message}`));
                
                // Rotate RPC and try again
                if (await this.rotateRpc()) {
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Retrying nonce fetch with new RPC...`));
                    this.currentNonce = await this.web3.eth.getTransactionCount(this.account.address);
                } else {
                    throw error; // Rethrow if we can't rotate
                }
            }
        } else {
            // For subsequent transactions, use the tracked nonce
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Using tracked nonce: ${this.currentNonce}`));
        }
        
        return this.currentNonce;
    }
    
    // Update nonce after a transaction is sent
    incrementNonce() {
        if (this.currentNonce !== null) {
            this.currentNonce++;
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Incremented nonce to: ${this.currentNonce}`));
        }
    }
    
    // NEW: Check mempool status (if supported by RPC)
    async checkMempoolStatus() {
        try {
            // Some RPC nodes provide mempool info via non-standard methods
            const response = await new Promise((resolve, reject) => {
                this.web3.currentProvider.send({
                    jsonrpc: '2.0',
                    method: 'txpool_status',
                    params: [],
                    id: new Date().getTime()
                }, (error, response) => {
                    if (error) reject(error);
                    else resolve(response);
                });
            });
            
            if (response && response.result) {
                const pending = parseInt(response.result.pending, 16);
                const queued = parseInt(response.result.queued, 16);
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Mempool status: ${pending} pending, ${queued} queued`));
                return { pending, queued, full: false };
            }
        } catch (error) {
            // Most nodes don't support this method, so we just log and move on
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Cannot check mempool status: ${error.message}`));
        }
        
        return { pending: 0, queued: 0, full: false };
    }
    
    // ENHANCED: Method to calculate the retry delay based on error and attempt count
    getRetryDelay(error, attemptCount) {
        const options = this.config.mempool_options;
        const baseDelay = options.retry_delay_base || 5000;
        const extraDelay = Math.random() * (options.retry_delay_extra || 5000);
        
        // Calculate exponential backoff based on attempt count
        const expBackoffFactor = Math.pow(2, attemptCount - 1);
        
        // Apply mempool multiplier if the error indicates mempool issues
        const isMempoolError = error && (
            error.includes("mempool is full") || 
            error.includes("already known") || 
            error.includes("nonce too low") ||
            error.includes("transaction underpriced") ||
            error.includes("replacement transaction underpriced")
        );
        
        const mempoolMultiplier = isMempoolError ? (options.mempool_retry_multiplier || 3) : 1;
        
        // Calculate final delay
        const delay = baseDelay * expBackoffFactor * mempoolMultiplier + extraDelay;
        
        // Log the calculated delay with reason
        let reason = `attempt ${attemptCount}`;
        if (isMempoolError) {
            reason += `, mempool issue (${mempoolMultiplier}x multiplier)`;
        }
        
        console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Retry delay: ${Math.round(delay/1000)}s (${reason})`));
        
        return Math.floor(delay);
    }
    
    // ENHANCED: Improved gas estimation with RPC rotation
    async estimateGas(txObject, retryCount = 0) {
        try {
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Optimizing gas estimation...`));
            
            // When estimating gas, we use a lower gas price to get a more accurate estimate
            // Some networks will return a higher gas estimate if the gas price is too high
            const lowGasPrice = this.web3.utils.toWei('1', 'gwei');
            
            // Create a modified transaction for estimation
            const estimationTx = {
                ...txObject,
                gasPrice: lowGasPrice
            };
            
            // Get the gas estimate from the blockchain
            let estimatedGas;
            try {
                estimatedGas = await this.web3.eth.estimateGas(estimationTx);
            } catch (gasError) {
                // If gas estimation fails, try with a higher value or rotate RPC
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Gas estimation failed: ${gasError.message}`));
                
                if (retryCount < 2 && this.config.mempool_options.rpc_rotation_enabled) {
                    // Try with a different RPC
                    await this.rotateRpc();
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Retrying gas estimation with new RPC...`));
                    return this.estimateGas(txObject, retryCount + 1);
                } else {
                    // Fall back to default value
                    return this.config.default_gas;
                }
            }
            
            // Apply a buffer to the estimated gas (10% extra) to ensure the transaction succeeds
            // This is common practice to avoid "out of gas" errors
            const gasBuffer = 1.1;
            const bufferedGas = Math.ceil(Number(estimatedGas) * gasBuffer);
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Estimated gas: ${estimatedGas}, with buffer: ${bufferedGas}`));
            
            return bufferedGas;
        } catch (error) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Gas estimation process failed: ${error.message}`));
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Using default gas: ${this.config.default_gas}`));
            return this.config.default_gas;
        }
    }
    
    // Convert normal decimal amount to wei format based on token decimals
    convertToWei(amount, tokenSymbol) {
        const decimals = this.tokenDecimals[tokenSymbol];
        return this.web3.utils.toWei(amount.toString(), 'ether');
    }
    
    // Get a random amount between min and max configured for the token, with proper decimal precision
    getRandomAmount(tokenSymbol) {
        if (!this.config.swap_amounts || !this.config.swap_amounts[tokenSymbol]) {
            // Use default values if not configured
            const defaults = {
                "USDT": 0.01,
                "BTC": 0.000001,
                "ETH": 0.00001
            };
            return this.convertToWei(defaults[tokenSymbol] || 0.01, tokenSymbol);
        }
        
        const tokenConfig = this.config.swap_amounts[tokenSymbol];
        const min = tokenConfig.min || 0;
        const max = tokenConfig.max || min;
        
        if (min >= max) {
            return this.convertToWei(min, tokenSymbol);
        }
        
        // Calculate random amount between min and max
        const range = max - min;
        const randomOffset = Math.random() * range;
        let randomAmount = min + randomOffset;
        
        // Get decimal precision settings or use defaults
        const decimalPrecisions = this.config.decimal_precision || {
            "USDT": 4,
            "BTC": 6, 
            "ETH": 5
        };
        
        // Get decimal precision for this token or use 4 as default
        const precision = decimalPrecisions[tokenSymbol] || 4;
        
        // Format the amount to have the specified number of decimal places
        // Using toFixed() to limit decimal places and parseFloat to remove trailing zeros
        randomAmount = parseFloat(randomAmount.toFixed(precision));
        
        console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Random amount (precision: ${precision}): ${randomAmount} ${tokenSymbol}`));
        
        // Convert to wei format
        return this.convertToWei(randomAmount, tokenSymbol);
    }
    
    // ENHANCED: Improved transaction sending with mempool handling
    async sendTransaction(txObject, description, retryCount = 0) {
        try {
            // Sign transaction
            const signedTx = await this.web3.eth.accounts.signTransaction(txObject, this.account.privateKey);
            
            // Display transaction hash immediately after signing
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Transaction created: ${signedTx.transactionHash}`));
            
            // Increment the nonce before sending the transaction
            this.incrementNonce();
            this.pendingTransactions++;
            
            // Create a spinner for better UX during confirmation waiting
            const spinner = ora({
                text: chalk.cyan(`${getTimestamp(this.walletNum)} Waiting for confirmation... (TX: ${signedTx.transactionHash.substring(0, 16)}...)`),
                spinner: 'dots'
            }).start();
            
            // Send transaction with proper timeout handling
            try {
                // Create a promise that will be rejected after timeout
                const timeout = 60000; // 60 seconds timeout
                
                // Use direct JSON-RPC call for sending transaction to avoid Web3's confirmation logic
                const txHash = await this.sendRawTransaction(signedTx);
                
                spinner.text = chalk.cyan(`${getTimestamp(this.walletNum)} Transaction submitted, waiting for confirmation... (TX: ${txHash.substring(0, 16)}...)`);
                
                // Wait a moment for the transaction to propagate
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Now manually check for transaction confirmation with custom timeout
                let confirmed = false;
                let receipt = null;
                const maxAttempts = 20; // 20 attempts with 3-second interval = ~60 seconds max wait
                let attempts = 0;
                
                while (!confirmed && attempts < maxAttempts) {
                    attempts++;
                    try {
                        // Try to get the transaction receipt
                        receipt = await this.web3.eth.getTransactionReceipt(txHash);
                        
                        if (receipt && receipt.blockNumber) {
                            // Transaction is confirmed
                            confirmed = true;
                            spinner.text = chalk.cyan(`${getTimestamp(this.walletNum)} Transaction confirmed in block ${receipt.blockNumber}`);
                        } else {
                            // Transaction is still pending
                            spinner.text = chalk.cyan(`${getTimestamp(this.walletNum)} Waiting for confirmation... (attempt ${attempts}/${maxAttempts})`);
                            // Wait before the next check
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }
                    } catch (error) {
                        // Error checking receipt, but transaction might still be confirming
                        spinner.text = chalk.cyan(`${getTimestamp(this.walletNum)} Checking status... (attempt ${attempts}/${maxAttempts})`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
                
                this.pendingTransactions--;
                
                if (confirmed) {
                    // Check transaction status (success = 1, failure = 0)
                    if (receipt.status) {
                        spinner.succeed(chalk.green(`${getTimestamp(this.walletNum)} ✓ ${description} successful: ${receipt.transactionHash}`));
                        
                        // Add a cooldown after successful confirmation
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        
                        return {
                            success: true,
                            txHash: receipt.transactionHash
                        };
                    } else {
                        // Transaction was mined but failed (e.g. due to out of gas or revert)
                        spinner.fail(chalk.red(`${getTimestamp(this.walletNum)} ✗ Transaction was mined but failed (reverted). TX: ${receipt.transactionHash}`));
                        return {
                            success: false,
                            error: `Transaction reverted. TX: ${receipt.transactionHash}`
                        };
                    }
                } else {
                    // Transaction didn't confirm within the timeout period
                    spinner.warn(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Transaction not confirmed within timeout period. It may still complete later. TX: ${txHash}`));
                    
                    // Add to failed transactions list for potential replacement
                    this.failedTransactions.push({
                        hash: txHash,
                        nonce: txObject.nonce,
                        gasPrice: txObject.gasPrice
                    });
                    
                    return {
                        success: false,
                        error: `Transaction not confirmed within timeout. TX: ${txHash}. It may still complete later.`
                    };
                }
            } catch (error) {
                this.pendingTransactions--;
                spinner.fail(chalk.red(`${getTimestamp(this.walletNum)} ✗ Transaction failed: ${error.message}`));
                
                // Check for specific mempool errors
                if (error.message.includes("mempool is full")) {
                    console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Mempool is full, will retry with higher gas price`));
                    
                    // If not too many retries yet, attempt to resend with higher gas
                    if (retryCount < this.config.max_retries) {
                        // Calculate delay for retry
                        const delay = this.getRetryDelay(error.message, retryCount + 1);
                        
                        // Wait before retrying
                        await new Promise(resolve => setTimeout(resolve, delay));
                        
                        // Try with a different RPC endpoint
                        if (this.config.mempool_options.rpc_rotation_enabled) {
                            await this.rotateRpc();
                        }
                        
                        // Get a new nonce in case our transaction was actually accepted
                        this.currentNonce = null;
                        const newNonce = await this.getNonce();
                        
                        // Calculate a higher gas price for retry
                        const newGasPrice = await this.getGasPrice(retryCount + 1);
                        
                        // Update transaction
                        const newTxObject = {
                            ...txObject,
                            nonce: newNonce,
                            gasPrice: newGasPrice
                        };
                        
                        // Retry with new parameters
                        console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Retrying transaction with higher gas price...`));
                        return this.sendTransaction(newTxObject, description, retryCount + 1);
                    }
                }
                
                // Return error for other cases
                return { 
                    success: false, 
                    error: error.message 
                };
            }
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error in transaction process: ${error.message}`));
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // Claim token from a faucet with improved transaction handling
    async claimFaucet(tokenSymbol) {
        if (!this.tokenContracts[tokenSymbol]) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Unknown token: ${tokenSymbol}`));
            return false;
        }
        
        const contractAddress = this.tokenContracts[tokenSymbol];
        console.log(chalk.blue(`${getTimestamp(this.walletNum)} Claiming ${tokenSymbol} from faucet...`));
        
        try {
            // Build transaction base
            const nonce = await this.getNonce();
            const gasPrice = await this.getGasPrice();
            
            // Transaction template for gas estimation
            const txTemplate = {
                from: this.account.address,
                to: contractAddress,
                data: this.functionSignatures.faucet,
                nonce: nonce,
                chainId: this.chainId
            };
            
            // Dynamically estimate gas exactly from the blockchain
            const gasLimit = await this.estimateGas(txTemplate);
            
            // Create transaction with only legacy gas parameters
            const tx = {
                ...txTemplate,
                gas: gasLimit,
                gasPrice: gasPrice
            };
            
            // Use the enhanced sendTransaction method
            return await this.sendTransaction(tx, `${tokenSymbol} faucet claim`);
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error claiming ${tokenSymbol}: ${error.message}`));
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // Approve token for swap with improved transaction handling
    async approveToken(tokenSymbol, amount = "1000000000000000000") {
        if (!this.tokenContracts[tokenSymbol]) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Unknown token: ${tokenSymbol}`));
            return false;
        }
        
        const tokenAddress = this.tokenContracts[tokenSymbol];
        console.log(chalk.blue(`${getTimestamp(this.walletNum)} Approving ${tokenSymbol} for swap...`));
        
        try {
            // Create contract instance
            const tokenContract = new this.web3.eth.Contract(this.erc20Abi, tokenAddress);
            
            // Check existing allowance
            const allowance = await tokenContract.methods.allowance(this.account.address, this.dexRouter).call();
            if (BigInt(allowance) >= BigInt(amount)) {
                console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ ${tokenSymbol} already approved for swap`));
                return { success: true };
            }
            
            // Use a very large number for approval (max uint256) to avoid needing multiple approvals
            const approvalAmount = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // 2^256 - 1
            
            // Prepare approval transaction
            const approveTx = tokenContract.methods.approve(this.dexRouter, approvalAmount);
            
            // Build transaction base
            const nonce = await this.getNonce();
            const gasPrice = await this.getGasPrice();
            
            // Transaction template for gas estimation
            const txTemplate = {
                from: this.account.address,
                to: tokenAddress,
                data: approveTx.encodeABI(),
                nonce: nonce,
                chainId: this.chainId
            };
            
            // Dynamically estimate gas exactly from the blockchain
            const gasLimit = await this.estimateGas(txTemplate);
            
            // Create transaction with only legacy gas parameters
            const tx = {
                ...txTemplate,
                gas: gasLimit,
                gasPrice: gasPrice
            };
            
            // Use the enhanced sendTransaction method
            return await this.sendTransaction(tx, `${tokenSymbol} approval`);
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error approving ${tokenSymbol}: ${error.message}`));
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // sendRawTransaction helper that bypasses Web3's confirmation logic
    async sendRawTransaction(signedTx) {
        return new Promise((resolve, reject) => {
            // Make a direct JSON-RPC call to avoid Web3's confirmation logic
            this.web3.currentProvider.send({
                jsonrpc: '2.0',
                method: 'eth_sendRawTransaction',
                params: [signedTx.rawTransaction],
                id: new Date().getTime()
            }, (error, response) => {
                if (error) {
                    reject(error);
                } else if (response.error) {
                    reject(new Error(response.error.message));
                } else {
                    resolve(response.result); // Return txHash
                }
            });
        });
    }

    // ENHANCED: Modified swapTokens method with improved mempool handling
    async swapTokens(fromToken, toToken, amount = null, retryCount = 0) {
        if (!this.tokenContracts[fromToken] || !this.tokenContracts[toToken]) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Invalid token pair: ${fromToken}-${toToken}`));
            return { success: false, error: "Invalid token pair" };
        }
        
        console.log(chalk.blue(`${getTimestamp(this.walletNum)} Swapping ${fromToken} to ${toToken}...`));
        
        try {
            // Determine token amount
            const fromTokenContract = new this.web3.eth.Contract(
                this.erc20Abi, 
                this.tokenContracts[fromToken]
            );
            
            if (!amount) {
                // Get a random amount between min and max from configuration
                amount = this.getRandomAmount(fromToken);
            }
            
            // Verify we have enough balance
            const balance = await fromTokenContract.methods.balanceOf(this.account.address).call();
            if (BigInt(balance) < BigInt(amount)) {
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Insufficient ${fromToken} balance`));
                if (BigInt(balance) <= 0) {
                    return { success: false, error: "Zero balance" };
                }
                amount = balance;
            }
            
            // Get decimal-formatted amount for display
            const displayAmount = this.web3.utils.fromWei(amount, 'ether');
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Using amount: ${displayAmount} ${fromToken}`));
            
            // Approve token first
            const approvalResult = await this.approveToken(fromToken, amount);
            if (!approvalResult.success) {
                return approvalResult;
            }
            
            // Check mempool status before proceeding
            await this.checkMempoolStatus();
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Preparing swap transaction...`));
            
            // Get nonce and gas price with retry factor if this is a retry
            const nonce = await this.getNonce();
            const gasPrice = await this.getGasPrice(retryCount);
            
            // Get current timestamp + 3600 seconds for deadline
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Prepare transaction data - using direct swap call format
            const swapData = "0x414bf389" + 
                this.tokenContracts[fromToken].slice(2).padStart(64, "0") +
                this.tokenContracts[toToken].slice(2).padStart(64, "0") +
                "0000000000000000000000000000000000000000000000000000000000000bb8" + // Slippage 0.3%
                this.account.address.slice(2).padStart(64, "0") +
                deadline.toString(16).padStart(64, "0") +
                BigInt(amount).toString(16).padStart(64, "0") +
                "0000000000000000000000000000000000000000000000000000000000000001" + // Min output amount (1 wei)
                "0000000000000000000000000000000000000000000000000000000000000000"; // No route
            
            // Transaction template for gas estimation
            const txTemplate = {
                from: this.account.address,
                to: this.dexRouter,
                data: swapData,
                nonce: nonce,
                chainId: this.chainId
            };
            
            // Dynamically estimate gas exactly from the blockchain
            const gasLimit = await this.estimateGas(txTemplate);
            
            // Create transaction with gas parameters
            const swapTransaction = {
                ...txTemplate,
                gas: gasLimit,
                gasPrice: gasPrice
            };
            
            // Use the enhanced sendTransaction method
            const swapResult = await this.sendTransaction(
                swapTransaction, 
                `Swap from ${fromToken} to ${toToken}`,
                retryCount
            );
            
            // Add a delay after swap regardless of success to avoid rate limits
            const cooldownDelay = 5000 + Math.random() * 2000;
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Cooling down for ${Math.round(cooldownDelay/1000)}s after swap...`));
            await new Promise(resolve => setTimeout(resolve, cooldownDelay));
            
            return swapResult;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error swapping ${fromToken} to ${toToken}: ${error.message}`));
            
            // Handle retry logic
            if (retryCount < this.config.max_retries) {
                const delay = this.getRetryDelay(error.message, retryCount + 1);
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Will retry in ${Math.round(delay/1000)}s...`));
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // If applicable, try with different RPC
                if (this.config.mempool_options.rpc_rotation_enabled) {
                    await this.rotateRpc();
                }
                
                return this.swapTokens(fromToken, toToken, amount, retryCount + 1);
            }
            
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // Run all faucet claims with enhanced retry logic
    async claimAllFaucets() {
        if (!this.config.enable_onchain_faucet) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Onchain faucet claims disabled in config`));
            return true;
        }
        
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting faucet claims for all tokens...`));
        
        const tokens = this.config.faucet_tokens || ["USDT", "BTC", "ETH"];
        
        for (const token of tokens) {
            let success = false;
            let attempts = 0;
            
            while (!success && attempts < this.config.max_retries) {
                attempts++;
                
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Claiming ${token} (Attempt ${attempts}/${this.config.max_retries})...`));
                const result = await this.claimFaucet(token);
                
                if (result.success) {
                    success = true;
                } else {
                    const waitTime = this.getRetryDelay(result.error, attempts);
                    console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Retrying in ${Math.round(waitTime/1000)}s...`));
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    
                    // If the error suggests mempool issues, try rotating RPC
                    if (result.error.includes("mempool") && this.config.mempool_options.rpc_rotation_enabled) {
                        await this.rotateRpc();
                    }
                }
            }
            
            if (!success) {
                console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to claim ${token} after ${this.config.max_retries} attempts`));
            }
            
            // Add delay between claims
            if (tokens.indexOf(token) < tokens.length - 1) {
                const delay = 5000 + Math.random() * 5000; // 5-10 second delay
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Waiting ${Math.round(delay/1000)}s between claims...`));
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Completed faucet claims`));
        return true;
    }
    
    // Execute all token swaps with improved delays and transaction handling
    async executeAllSwaps() {
        if (!this.config.enable_token_swap) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Token swaps disabled in config`));
            return true;
        }
        
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting token swaps for configured pairs...`));
        
        const swapPairs = this.config.swap_pairs || [
            { from: "USDT", to: "BTC", count: 1 },
            { from: "USDT", to: "ETH", count: 1 },
            { from: "BTC", to: "USDT", count: 1 },
            { from: "ETH", to: "USDT", count: 1 }
        ];
        
        for (const pair of swapPairs) {
            const { from, to, count } = pair;
            const swapCount = count || 1;
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Executing ${swapCount} swaps for ${from}-${to} pair...`));
            
            for (let i = 0; i < swapCount; i++) {
                let success = false;
                let attempts = 0;
                
                while (!success && attempts < this.config.max_retries) {
                    attempts++;
                    
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Swap ${i+1}/${swapCount} (Attempt ${attempts}/${this.config.max_retries})...`));
                    const result = await this.swapTokens(from, to);
                    
                    if (result.success) {
                        success = true;
                    } else if (result.error === "Zero balance") {
                        // Skip this pair if we have zero balance
                        console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Skipping remaining ${from}-${to} swaps due to zero balance`));
                        i = swapCount; // Exit the loop
                        break;
                    } else {
                        // If it's a mempool error, try a longer delay and RPC rotation
                        if (result.error.includes("mempool") && this.config.mempool_options.rpc_rotation_enabled) {
                            await this.rotateRpc();
                        }
                        
                        const waitTime = this.getRetryDelay(result.error, attempts);
                        console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Retrying in ${Math.round(waitTime/1000)}s...`));
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                
                if (!success && attempts >= this.config.max_retries) {
                    console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to swap ${from}-${to} after ${this.config.max_retries} attempts`));
                }
                
                // Add longer delay between swaps to allow transactions to be mined
                if (i < swapCount - 1) {
                    const delay = 7000 + Math.random() * 8000; // 7-15 second delay
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Waiting ${Math.round(delay/1000)}s for transaction to be mined before next swap...`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            // Add longer delay between pairs
            if (swapPairs.indexOf(pair) < swapPairs.length - 1) {
                const delay = 7000 + Math.random() * 8000; // 7-15 second delay
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Waiting ${Math.round(delay/1000)}s between pairs...`));
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Completed all token swaps`));
        return true;
    }
    
    // NEW: Replace a stuck transaction with higher gas price
    async replaceTransaction(txHash, increaseFactor = 1.5) {
        try {
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Attempting to replace transaction: ${txHash}`));
            
            // Get the original transaction
            const tx = await this.web3.eth.getTransaction(txHash);
            if (!tx) {
                throw new Error("Transaction not found");
            }
            
            // Make sure it's our transaction
            if (tx.from.toLowerCase() !== this.account.address.toLowerCase()) {
                throw new Error("Not our transaction");
            }
            
            // Make sure it's still pending
            const receipt = await this.web3.eth.getTransactionReceipt(txHash);
            if (receipt && receipt.blockNumber) {
                throw new Error("Transaction already confirmed");
            }
            
            // Calculate new gas price (at least 10% higher than original)
            const minIncrease = increaseFactor > 1.1 ? increaseFactor : 1.1;
            const newGasPrice = BigInt(Math.floor(Number(tx.gasPrice) * minIncrease));
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Original gas price: ${this.web3.utils.fromWei(tx.gasPrice, 'gwei')} gwei`));
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ New gas price: ${this.web3.utils.fromWei(newGasPrice.toString(), 'gwei')} gwei (${minIncrease}x)`));
            
            // Create a replacement transaction
            const replacementTx = {
                from: tx.from,
                to: tx.to,
                data: tx.input,
                nonce: tx.nonce,
                gas: tx.gas,
                gasPrice: newGasPrice.toString(),
                chainId: this.chainId
            };
            
            // Sign and send the replacement
            const signedTx = await this.web3.eth.accounts.signTransaction(replacementTx, this.account.privateKey);
            
            // Send the raw transaction
            const newTxHash = await this.sendRawTransaction(signedTx);
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Replacement transaction sent: ${newTxHash}`));
            
            return {
                success: true,
                oldTxHash: txHash,
                newTxHash: newTxHash
            };
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error replacing transaction: ${error.message}`));
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // NEW: Attempt to replace all stuck transactions
    async replaceStuckTransactions() {
        if (this.failedTransactions.length === 0) {
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ No stuck transactions to replace`));
            return true;
        }
        
        console.log(chalk.blue(`${getTimestamp(this.walletNum)} Attempting to replace ${this.failedTransactions.length} stuck transactions...`));
        
        for (const tx of this.failedTransactions) {
            // Try to replace the transaction
            const result = await this.replaceTransaction(tx.hash, 1.5);
            
            if (result.success) {
                // Remove from the list if replaced successfully
                this.failedTransactions = this.failedTransactions.filter(t => t.hash !== tx.hash);
            }
            
            // Add delay between replacements
            if (this.failedTransactions.indexOf(tx) < this.failedTransactions.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        
        return true;
    }
    
    // Run the full token operation cycle with enhanced error handling
    async executeTokenOperations() {
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting token operations...`));
        
        try {
            // Reset nonce tracking at the start of operations
            this.currentNonce = null;
            
            // Step 1: Claim all tokens from faucets
            await this.claimAllFaucets();
            
            // Step 2: Execute all token swaps
            await this.executeAllSwaps();
            
            // Step 3: Check and replace any stuck transactions
            if (this.failedTransactions.length > 0) {
                await this.replaceStuckTransactions();
            }
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Token operations completed successfully!`));
            return true;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error in token operations: ${error.message}`));
            return false;
        }
    }
    
    // Reset nonce tracking (can be used to recover from errors)
    async resetNonce() {
        try {
            // Get the current nonce from the network
            const networkNonce = await this.web3.eth.getTransactionCount(this.account.address);
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Reset nonce from ${this.currentNonce} to ${networkNonce} (from network)`));
            this.currentNonce = networkNonce;
            return true;
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error resetting nonce: ${error.message}`));
            return false;
        }
    }
}

module.exports = TokenSwapper;
