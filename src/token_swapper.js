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
            gas_price_multiplier: 1.1,
            default_gas: 150000,
            max_retries: 3
        };
        
        // Load configuration, merging with defaults
        this.config = { ...this.defaultConfig, ...config };
        
        // RPC connection
        this.rpcUrl = "https://evmrpc-testnet.0g.ai";
        this.web3 = new Web3(this.rpcUrl);
        
        // Chain ID
        this.chainId = 16600;
        
        // Setup account
        if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
        }
        this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
        this.walletNum = null;
        
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
    
    async getGasPrice() {
        const gasPrice = BigInt(await this.web3.eth.getGasPrice());
        const multiplier = Math.floor(this.config.gas_price_multiplier * 100);
        return (gasPrice * BigInt(multiplier) / BigInt(100)).toString();
    }
    
    async getNonce() {
        return await this.web3.eth.getTransactionCount(this.account.address);
    }
    
    // Convert normal decimal amount to wei format based on token decimals
    convertToWei(amount, tokenSymbol) {
        const decimals = this.tokenDecimals[tokenSymbol];
        return this.web3.utils.toWei(amount.toString(), 'ether');
    }
    
    // Get a random amount between min and max configured for the token, converted to wei
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
        const randomAmount = min + randomOffset;
        
        // Convert to wei format
        return this.convertToWei(randomAmount, tokenSymbol);
    }
    
    // Claim token from a faucet
    async claimFaucet(tokenSymbol) {
        if (!this.tokenContracts[tokenSymbol]) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Unknown token: ${tokenSymbol}`));
            return false;
        }
        
        const contractAddress = this.tokenContracts[tokenSymbol];
        console.log(chalk.blue(`${getTimestamp(this.walletNum)} Claiming ${tokenSymbol} from faucet...`));
        
        try {
            // Build transaction
            const nonce = await this.getNonce();
            const gasPrice = await this.getGasPrice();
            
            const tx = {
                from: this.account.address,
                to: contractAddress,
                data: this.functionSignatures.faucet,
                gas: this.config.default_gas,
                gasPrice: gasPrice,
                nonce: nonce,
                chainId: this.chainId
            };
            
            // Sign and send transaction
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Successfully claimed ${tokenSymbol}: ${receipt.transactionHash}`));
            
            // Add slight delay to ensure transaction is processed
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            return {
                success: true,
                txHash: receipt.transactionHash
            };
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error claiming ${tokenSymbol}: ${error.message}`));
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // Approve token for swap
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
            
            // Build transaction
            const nonce = await this.getNonce();
            const gasPrice = await this.getGasPrice();
            
            // Estimate gas
            const estimatedGas = await approveTx.estimateGas({
                from: this.account.address
            });
            
            const tx = {
                from: this.account.address,
                to: tokenAddress,
                data: approveTx.encodeABI(),
                gas: Math.floor(Number(estimatedGas) * 1.2), // 20% buffer
                gasPrice: gasPrice,
                nonce: nonce,
                chainId: this.chainId
            };
            
            // Sign and send transaction
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ ${tokenSymbol} approval successful: ${receipt.transactionHash}`));
            
            // Add slightly longer delay to ensure transaction is processed
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            return {
                success: true,
                txHash: receipt.transactionHash
            };
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error approving ${tokenSymbol}: ${error.message}`));
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // Execute token swap using direct method (working approach)
    async swapTokens(fromToken, toToken, amount = null) {
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
            
            // Direct swap implementation based on working approach
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Attempting direct swap...`));
            
            // Get nonce and gas price
            const nonce = await this.getNonce();
            const gasPrice = await this.getGasPrice();
            
            // Get current timestamp + 3600 seconds for deadline
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Prepare transaction data
            const directSwapTransaction = {
                chainId: this.chainId,
                data: "0x414bf389" + 
                    this.tokenContracts[fromToken].slice(2).padStart(64, "0") +
                    this.tokenContracts[toToken].slice(2).padStart(64, "0") +
                    "0000000000000000000000000000000000000000000000000000000000000bb8" +
                    this.account.address.slice(2).padStart(64, "0") +
                    deadline.toString(16).padStart(64, "0") +
                    BigInt(amount).toString(16).padStart(64, "0") +
                    "0000000000000000000000000000000000000000000000000000000000000001" +
                    "0000000000000000000000000000000000000000000000000000000000000000",
                from: this.account.address,
                gas: "0x1e8480", // 2,000,000 
                gasPrice: gasPrice,
                nonce: "0x" + nonce.toString(16),
                to: this.dexRouter
            };
            
            // Sign and send transaction
            const signedTx = await this.web3.eth.accounts.signTransaction(directSwapTransaction, this.account.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Direct swap from ${fromToken} to ${toToken} successful: ${receipt.transactionHash}`));
            
            return {
                success: true,
                txHash: receipt.transactionHash
            };
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error swapping ${fromToken} to ${toToken}: ${error.message}`));
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // Run all faucet claims
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
                    const waitTime = Math.pow(2, attempts) * 1000;
                    console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Retrying in ${waitTime/1000}s...`));
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
            
            if (!success) {
                console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to claim ${token} after ${this.config.max_retries} attempts`));
            }
            
            // Add delay between claims
            if (tokens.indexOf(token) < tokens.length - 1) {
                const delay = Math.random() * 3000 + 2000; // 2-5 second delay
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Completed faucet claims`));
        return true;
    }
    
    // Execute all token swaps
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
                        const waitTime = Math.pow(2, attempts) * 1000;
                        console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Retrying in ${waitTime/1000}s...`));
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                
                if (!success && attempts >= this.config.max_retries) {
                    console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to swap ${from}-${to} after ${this.config.max_retries} attempts`));
                }
                
                // Add delay between swaps
                if (i < swapCount - 1) {
                    const delay = Math.random() * 5000 + 3000; // 3-8 second delay
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            // Add delay between pairs
            if (swapPairs.indexOf(pair) < swapPairs.length - 1) {
                const delay = Math.random() * 5000 + 5000; // 5-10 second delay
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Completed all token swaps`));
        return true;
    }
    
    // Run the full token operation cycle
    async executeTokenOperations() {
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting token operations...`));
        
        try {
            // Step 1: Claim all tokens from faucets
            await this.claimAllFaucets();
            
            // Step 2: Execute all token swaps
            await this.executeAllSwaps();
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Token operations completed successfully!`));
            return true;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error in token operations: ${error.message}`));
            return false;
        }
    }
}

module.exports = TokenSwapper;
