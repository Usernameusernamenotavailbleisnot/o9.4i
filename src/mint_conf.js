const { Web3 } = require('web3');
const chalk = require('chalk');
const ora = require('ora');
const crypto = require('crypto');
const { faker } = require('@faker-js/faker');

function getTimestamp(walletNum = null) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    if (walletNum !== null) {
        return `[${timestamp} - Wallet ${walletNum}]`;
    }
    return `[${timestamp}]`;
}

// Generate a domain name based on people's names using Faker
function generateRandomDomainName(length = 6) {
    // Options for formats:
    // 1. first name only
    // 2. first name + number
    // 3. first + last initial
    // 4. first initial + last name
    // 5. first name + last name (if fits within length)
    
    const format = Math.floor(Math.random() * 5);
    const firstName = faker.person.firstName().toLowerCase();
    const lastName = faker.person.lastName().toLowerCase();
    
    let domainName = "";
    
    switch (format) {
        case 0: // first name only
            domainName = firstName.substring(0, length);
            break;
        case 1: // first name + number
            const number = Math.floor(Math.random() * 999) + 1;
            domainName = firstName.substring(0, length - String(number).length) + number;
            break;
        case 2: // first + last initial
            domainName = firstName.substring(0, length - 1) + lastName.charAt(0);
            break;
        case 3: // first initial + last name
            domainName = firstName.charAt(0) + lastName.substring(0, length - 1);
            break;
        case 4: // first name + last name (if fits)
            const combined = firstName + lastName;
            domainName = combined.substring(0, length);
            break;
    }
    
    // Ensure we don't exceed the desired length and remove any non-alphanumeric characters
    return domainName.substring(0, length).replace(/[^a-z0-9]/g, '');
}

class MintConfigurator {
    constructor(privateKey, config = {}) {
        // Default configuration
        this.defaultConfig = {
            enable_mint_nft: true,
            enable_mint_domain: true,
            mint_nft: {
                count: {
                    min: 1, 
                    max: 3
                }
            },
            mint_domain: {
                count: {
                    min: 1,
                    max: 2
                },
                name_length: {
                    min: 4,
                    max: 8
                }
            },
            gas_price_multiplier: 1.1,
            max_retries: 3
        };
        
        // Load configuration
        this.config = { ...this.defaultConfig, ...config.mint_conf };
        
        // Setup web3 connection
        this.rpcUrl = "https://evmrpc-testnet.0g.ai";
        this.web3 = new Web3(this.rpcUrl);
        
        // Setup account
        if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
        }
        this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
        this.walletNum = null;
        
        // Add nonce tracking to avoid transaction issues
        this.currentNonce = null;
        
        // Hardcoded NFT contracts info
        this.nftContracts = [
            {
                name: "Miner's Legacy",
                address: "0x9059cA87Ddc891b91e731C57D21809F1A4adC8D9",
                methodId: "0x1249c58b"
            }
        ];
        
        // Hardcoded domain contract info
        this.domainContract = {
            address: "0xCF7f37B4916AC5c530C863f8c8bB26Ec1e8d2Ccb",
            methodId: "0x692b3956"
        };
    }
    
    setWalletNum(num) {
        this.walletNum = num;
    }
    
    // Get the next nonce, considering pending transactions
    async getNonce() {
        if (this.currentNonce === null) {
            // If this is the first transaction, get the nonce from the network
            this.currentNonce = await this.web3.eth.getTransactionCount(this.account.address);
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Initial nonce from network: ${this.currentNonce}`));
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
    
    async getGasPrice() {
        try {
            // Get the current gas price from the network
            const gasPrice = await this.web3.eth.getGasPrice();
            
            // Apply gas price multiplier
            const multiplier = this.config.gas_price_multiplier || 1.1;
            const adjustedGasPrice = (BigInt(gasPrice) * BigInt(Math.floor(multiplier * 100)) / BigInt(100)).toString();
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Network gas price: ${this.web3.utils.fromWei(gasPrice, 'gwei')} gwei, adjusted: ${this.web3.utils.fromWei(adjustedGasPrice, 'gwei')} gwei`));
            
            return adjustedGasPrice;
        } catch (error) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Error getting gas price: ${error.message}`));
            
            // Fallback to a low gas price
            const fallbackGasPrice = this.web3.utils.toWei('25', 'gwei'); // Using 25 gwei as default from your example
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Using fallback gas price: 25 gwei`));
            
            return fallbackGasPrice;
        }
    }
    
    async estimateGas(txObject) {
        try {
            // Get the gas estimate from the blockchain
            const estimatedGas = await this.web3.eth.estimateGas(txObject);
            
            // Add 20% buffer for safety
            const gasWithBuffer = Math.floor(Number(estimatedGas) * 1.2);
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Estimated gas: ${estimatedGas}, with buffer: ${gasWithBuffer}`));
            
            return gasWithBuffer;
        } catch (error) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Gas estimation failed: ${error.message}`));
            
            // Use default gas limits based on transaction type
            let defaultGas;
            if (txObject.data === this.config.mint_nft.contracts[0].methodId) {
                defaultGas = 160000; // Default gas for minting NFT
            } else {
                defaultGas = 360000; // Default gas for minting domain
            }
            
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Using default gas: ${defaultGas}`));
            return defaultGas;
        }
    }
    
    async mintNFT(contractConfig) {
        try {
            const { address, methodId, name } = contractConfig;
            console.log(chalk.blue(`${getTimestamp(this.walletNum)} Minting ${name || 'NFT'} from contract ${address}...`));
            
            // Get current nonce and gas price
            const nonce = await this.getNonce();
            const gasPrice = await this.getGasPrice();
            
            // Create transaction template for gas estimation
            const txTemplate = {
                from: this.account.address,
                to: address,
                data: methodId, // Simple mint function call
                nonce: nonce,
                value: "0x0",
                chainId: 16600
            };
            
            // Estimate gas
            const gasLimit = await this.estimateGas(txTemplate);
            
            // Create the transaction
            const tx = {
                ...txTemplate,
                gas: gasLimit,
                gasPrice: gasPrice
            };
            
            // Sign and send transaction
            const spinner = ora({
                text: chalk.cyan(`${getTimestamp(this.walletNum)} Signing transaction...`),
                spinner: 'dots'
            }).start();
            
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            
            spinner.text = chalk.cyan(`${getTimestamp(this.walletNum)} Transaction created, sending...`);
            
            // Increment nonce before sending
            this.incrementNonce();
            
            // Send the transaction
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            spinner.succeed(chalk.green(`${getTimestamp(this.walletNum)} ✓ NFT minted successfully: ${receipt.transactionHash}`));
            
            return {
                success: true,
                txHash: receipt.transactionHash
            };
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error minting NFT: ${error.message}`));
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    encodeDomainMintParams(domainName) {
        // Encode parameters based on the example transaction
        // The example has methodId 0x692b3956 with params for domain name
        
        // Convert domain name to bytes32 hex string and pad with zeros
        const domainNameHex = Buffer.from(domainName).toString('hex').padEnd(64, '0');
        
        // Construct the params similar to the example transaction
        // Positions and values are based on the decoded input data from the example
        const encodedParams = 
            "0000000000000000000000000000000000000000000000000000000000000060" + // First parameter location - points to domainName
            "0000000000000000000000000000000000000000000000000000000000000001" + // Second parameter - typically means quantity or bool 
            "0000000000000000000000000000000000000000000000000000000000000001" + // Third parameter - typically some config setting
            "000000000000000000000000000000000000000000000000000000000000000" + domainName.length.toString(16) + // Length of domain name
            domainNameHex; // Domain name in hex
            
        return "0x692b3956" + encodedParams;
    }
    
    async mintDomain(domainName) {
        try {
            const { address, methodId } = this.domainContract;
            console.log(chalk.blue(`${getTimestamp(this.walletNum)} Minting domain "${domainName}" from contract ${address}...`));
            
            // Encode the transaction data for domain minting
            const data = this.encodeDomainMintParams(domainName);
            
            // Get current nonce and gas price
            const nonce = await this.getNonce();
            const gasPrice = await this.getGasPrice();
            
            // Create transaction template for gas estimation
            const txTemplate = {
                from: this.account.address,
                to: address,
                data: data,
                nonce: nonce,
                value: "0x0",
                chainId: 16600
            };
            
            // Estimate gas
            const gasLimit = await this.estimateGas(txTemplate);
            
            // Create the transaction
            const tx = {
                ...txTemplate,
                gas: gasLimit,
                gasPrice: gasPrice
            };
            
            // Sign and send transaction
            const spinner = ora({
                text: chalk.cyan(`${getTimestamp(this.walletNum)} Signing transaction...`),
                spinner: 'dots'
            }).start();
            
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            
            spinner.text = chalk.cyan(`${getTimestamp(this.walletNum)} Transaction created, sending...`);
            
            // Increment nonce before sending
            this.incrementNonce();
            
            // Send the transaction
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            spinner.succeed(chalk.green(`${getTimestamp(this.walletNum)} ✓ Domain "${domainName}" minted successfully: ${receipt.transactionHash}`));
            
            return {
                success: true,
                txHash: receipt.transactionHash,
                domainName: domainName
            };
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error minting domain: ${error.message}`));
            return {
                success: false,
                error: error.message,
                domainName: domainName
            };
        }
    }
    
    async executeMintNFT() {
        if (!this.config.enable_mint_nft) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ NFT minting disabled in config`));
            return true;
        }
        
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting NFT minting operations...`));
        
        try {
            // Determine number of NFTs to mint
            const minMint = Math.max(1, this.config.mint_nft.count.min || 1);
            const maxMint = Math.max(minMint, this.config.mint_nft.count.max || 3);
            const mintCount = Math.floor(Math.random() * (maxMint - minMint + 1)) + minMint;
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Will mint ${mintCount} NFTs...`));
            
            let successCount = 0;
            
            for (let i = 0; i < mintCount; i++) {
                // Select a random NFT contract from the available ones
                const contract = this.nftContracts[Math.floor(Math.random() * this.nftContracts.length)];
                
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Minting NFT ${i+1}/${mintCount} (${contract.name || 'Unknown'})...`));
                
                let success = false;
                let attempts = 0;
                let result;
                
                // Try to mint with retries
                while (!success && attempts < this.config.max_retries) {
                    attempts++;
                    
                    if (attempts > 1) {
                        console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Retry attempt ${attempts}/${this.config.max_retries}...`));
                    }
                    
                    result = await this.mintNFT(contract);
                    
                    if (result.success) {
                        success = true;
                        successCount++;
                    } else if (attempts < this.config.max_retries) {
                        // Wait before retrying
                        const waitTime = Math.pow(2, attempts) * 1000;
                        console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Waiting ${waitTime/1000}s before retrying...`));
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                
                if (!success) {
                    console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to mint NFT after ${this.config.max_retries} attempts: ${result ? result.error : 'unknown error'}`));
                }
                
                // Add a delay between mints
                if (i < mintCount - 1) {
                    const delay = Math.random() * 10000 + 5000; // 5-15 seconds
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Waiting ${Math.round(delay/1000)}s before next mint...`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Completed NFT minting operations: ${successCount}/${mintCount} successful`));
            return true;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error in NFT minting operations: ${error.message}`));
            return false;
        }
    }
    
    async executeMintDomain() {
        if (!this.config.enable_mint_domain) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Domain minting disabled in config`));
            return true;
        }
        
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting domain minting operations...`));
        
        try {
            // Determine number of domains to mint
            const minMint = Math.max(1, this.config.mint_domain.count.min || 1);
            const maxMint = Math.max(minMint, this.config.mint_domain.count.max || 2);
            const mintCount = Math.floor(Math.random() * (maxMint - minMint + 1)) + minMint;
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Will mint ${mintCount} domains...`));
            
            let successCount = 0;
            
            for (let i = 0; i < mintCount; i++) {
                // Generate a random domain name
                const minLength = Math.max(2, this.config.mint_domain.name_length.min || 4);
                const maxLength = Math.max(minLength, this.config.mint_domain.name_length.max || 8);
                const nameLength = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
                
                const domainName = generateRandomDomainName(nameLength);
                
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Minting domain ${i+1}/${mintCount} (${domainName})...`));
                
                let success = false;
                let attempts = 0;
                let result;
                
                // Try to mint with retries
                while (!success && attempts < this.config.max_retries) {
                    attempts++;
                    
                    if (attempts > 1) {
                        console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Retry attempt ${attempts}/${this.config.max_retries}...`));
                    }
                    
                    result = await this.mintDomain(domainName);
                    
                    if (result.success) {
                        success = true;
                        successCount++;
                    } else if (attempts < this.config.max_retries) {
                        // Wait before retrying
                        const waitTime = Math.pow(2, attempts) * 1000;
                        console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Waiting ${waitTime/1000}s before retrying...`));
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                
                if (!success) {
                    console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to mint domain after ${this.config.max_retries} attempts: ${result ? result.error : 'unknown error'}`));
                }
                
                // Add a delay between mints
                if (i < mintCount - 1) {
                    const delay = Math.random() * 10000 + 5000; // 5-15 seconds
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Waiting ${Math.round(delay/1000)}s before next mint...`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Completed domain minting operations: ${successCount}/${mintCount} successful`));
            return true;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error in domain minting operations: ${error.message}`));
            return false;
        }
    }
    
    async executeAllMintOperations() {
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting all minting operations...`));
        
        try {
            // Reset nonce tracking at the start of operations
            this.currentNonce = null;
            
            // First mint NFTs
            if (this.config.enable_mint_nft) {
                await this.executeMintNFT();
            }
            
            // Then mint domains
            if (this.config.enable_mint_domain) {
                await this.executeMintDomain();
            }
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ All minting operations completed successfully!`));
            return true;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error in minting operations: ${error.message}`));
            return false;
        }
    }
}

module.exports = MintConfigurator;
