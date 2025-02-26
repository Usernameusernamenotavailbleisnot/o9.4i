const { Web3 } = require('web3');
const fs = require('fs').promises;
const chalk = require('chalk');
const ora = require('ora');
const solc = require('solc');
const crypto = require('crypto');

function getTimestamp(walletNum = null) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    if (walletNum !== null) {
        return `[${timestamp} - Wallet ${walletNum}]`;
    }
    return `[${timestamp}]`;
}

// Token name generators for popular meme/crypto tokens
const TOKEN_NAME_PREFIXES = [
    'Moon', 'Doge', 'Shib', 'Pepe', 'Ape', 'Baby', 'Safe', 'Floki', 'Elon', 'Mars',
    'Space', 'Rocket', 'Diamond', 'Crypto', 'Meme', 'Chad', 'Bull', 'Super', 'Mega', 'Meta',
    'Ninja', 'Turbo', 'Lambo', 'Hodl', 'Pump', 'King', 'Based', 'Alpha', 'Sigma', 'Giga'
];

const TOKEN_NAME_SUFFIXES = [
    'Coin', 'Token', 'Cash', 'Swap', 'Inu', 'Dao', 'Moon', 'Doge', 'Chain', 'Finance',
    'Protocol', 'Network', 'Exchange', 'Capital', 'Money', 'Rocket', 'Rise', 'Gains', 'Pump', 'Whale',
    'Bit', 'Satoshi', 'Elon', 'Mars', 'Galaxy', 'Star', 'Nova', 'Verse', 'World', 'Gem'
];

// ERC20 Contract template
const ERC20_CONTRACT_TEMPLATE = `
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract {{CONTRACT_NAME}} {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    address public owner;
    
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 value);
    event Burn(address indexed from, uint256 value);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        totalSupply = 0;
        owner = msg.sender;
    }
    
    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }
    
    function transfer(address to, uint256 amount) public returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }
    
    function allowance(address owner, address spender) public view returns (uint256) {
        return _allowances[owner][spender];
    }
    
    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(_allowances[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        
        _allowances[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        
        return true;
    }
    
    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        _approve(msg.sender, spender, _allowances[msg.sender][spender] + addedValue);
        return true;
    }
    
    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        uint256 currentAllowance = _allowances[msg.sender][spender];
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        
        _approve(msg.sender, spender, currentAllowance - subtractedValue);
        return true;
    }
    
    function mint(address to, uint256 amount) public onlyOwner {
        require(to != address(0), "ERC20: mint to the zero address");
        
        totalSupply += amount;
        _balances[to] += amount;
        
        emit Transfer(address(0), to, amount);
        emit Mint(to, amount);
    }
    
    function burn(uint256 amount) public {
        require(_balances[msg.sender] >= amount, "ERC20: burn amount exceeds balance");
        
        _balances[msg.sender] -= amount;
        totalSupply -= amount;
        
        emit Transfer(msg.sender, address(0), amount);
        emit Burn(msg.sender, amount);
    }
    
    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(_balances[from] >= amount, "ERC20: transfer amount exceeds balance");
        
        _balances[from] -= amount;
        _balances[to] += amount;
        
        emit Transfer(from, to, amount);
    }
    
    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");
        
        _allowances[owner][spender] = amount;
        
        emit Approval(owner, spender, amount);
    }
}
`;

class ERC20TokenDeployer {
    constructor(privateKey, config = {}) {
        // Default ERC20 configuration
        this.defaultConfig = {
            enable_erc20: true,
            mint_amount: {
                min: 1000000,
                max: 10000000
            },
            burn_percentage: 10,
            decimals: 18
        };
        
        // Load configuration
        this.config = { ...this.defaultConfig, ...config.erc20 };
        
        // Setup web3 connection
        this.rpcUrl = "https://evmrpc-testnet.0g.ai";
        this.web3 = new Web3(this.rpcUrl);
        
        // Setup account
        if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
        }
        this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
        
        this.walletNum = null;
    }
    
    setWalletNum(num) {
        this.walletNum = num;
    }
    
    generateRandomTokenName() {
        const prefix = TOKEN_NAME_PREFIXES[Math.floor(Math.random() * TOKEN_NAME_PREFIXES.length)];
        const suffix = TOKEN_NAME_SUFFIXES[Math.floor(Math.random() * TOKEN_NAME_SUFFIXES.length)];
        return `${prefix} ${suffix}`;
    }
    
    generateTokenSymbol(name) {
        // Create a symbol from the first letters of each word in the name, up to 4-5 characters
        const symbol = name.split(' ')
            .map(word => word.charAt(0).toUpperCase())
            .join('');
            
        // If symbol is too long, take first 4-5 chars of first word
        if (symbol.length > 5) {
            return name.split(' ')[0].substring(0, 4).toUpperCase();
        }
        
        return symbol;
    }
    
    async compileContract(contractName) {
        const spinner = ora(`Compiling ERC20 token contract (${contractName})...`).start();
        
        try {
            // Replace placeholder in template with actual contract name
            const contractSource = ERC20_CONTRACT_TEMPLATE.replace(/{{CONTRACT_NAME}}/g, contractName);
            
            // Setup compiler input with specific EVM version to ensure compatibility
            const input = {
                language: 'Solidity',
                sources: {
                    'TokenContract.sol': {
                        content: contractSource
                    }
                },
                settings: {
                    outputSelection: {
                        '*': {
                            '*': ['abi', 'evm.bytecode']
                        }
                    },
                    optimizer: {
                        enabled: true,
                        runs: 200
                    },
                    evmVersion: 'paris' // Use paris EVM version (before Shanghai which introduced PUSH0)
                }
            };
            
            // Compile the contract
            const output = JSON.parse(solc.compile(JSON.stringify(input)));
            
            // Check for errors
            if (output.errors) {
                const errors = output.errors.filter(error => error.severity === 'error');
                if (errors.length > 0) {
                    throw new Error(`Compilation errors: ${errors.map(e => e.message).join(', ')}`);
                }
            }
            
            // Extract the contract
            const contract = output.contracts['TokenContract.sol'][contractName];
            
            spinner.succeed('ERC20 token contract compiled successfully!');
            
            return {
                abi: contract.abi,
                bytecode: contract.evm.bytecode.object
            };
        } catch (error) {
            spinner.fail(`Failed to compile ERC20 token contract: ${error.message}`);
            throw error;
        }
    }
    
    async deployContract(contractName, symbol, decimals) {
        const spinner = ora(`Deploying ERC20 token "${contractName}" (${symbol})...`).start();
        
        try {
            // Format contract name for Solidity (remove spaces and special chars)
            const solContractName = contractName.replace(/[^a-zA-Z0-9]/g, '');
            
            // Compile the contract
            const compiledContract = await this.compileContract(solContractName);
            
            // Create contract instance for deployment
            const contract = new this.web3.eth.Contract(compiledContract.abi);
            
            // Prepare deployment transaction
            const deployTx = contract.deploy({
                data: '0x' + compiledContract.bytecode,
                arguments: [contractName, symbol, decimals]
            });
            
            // Get gas price with multiplier for faster confirmation
            const gasPrice = BigInt(await this.web3.eth.getGasPrice());
            const adjustedGasPrice = (gasPrice * BigInt(110) / BigInt(100)).toString(); // 10% higher
            
            // Estimate gas
            const estimatedGas = await deployTx.estimateGas({
                from: this.account.address
            });
            
            // Prepare transaction object
            const nonce = await this.web3.eth.getTransactionCount(this.account.address);
            const tx = {
                from: this.account.address,
                nonce: nonce,
                gas: Math.floor(Number(estimatedGas) * 1.2), // Add 20% buffer
                gasPrice: adjustedGasPrice,
                data: deployTx.encodeABI(),
                chainId: await this.web3.eth.getChainId()
            };
            
            // Sign transaction
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            
            // Send the transaction
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            spinner.succeed(`ERC20 token contract deployed at: ${receipt.contractAddress}`);
            
            return {
                contractAddress: receipt.contractAddress,
                abi: compiledContract.abi,
                name: contractName,
                symbol: symbol,
                txHash: receipt.transactionHash
            };
        } catch (error) {
            spinner.fail(`Failed to deploy ERC20 token contract: ${error.message}`);
            throw error;
        }
    }
    
    formatTokenAmount(amount, decimals) {
        // Convert normal amount to token amount with decimals (e.g., 100 -> 100000000000000000000 for 18 decimals)
        return BigInt(amount) * BigInt(10) ** BigInt(decimals);
    }
    
    async mintTokens(contractAddress, abi, amount, decimals) {
        try {
            // Create contract instance
            const contract = new this.web3.eth.Contract(abi, contractAddress);
            
            // Format the amount with decimals
            const formattedAmount = this.formatTokenAmount(amount, decimals).toString();
            
            // Prepare the mint transaction
            const mintTx = contract.methods.mint(this.account.address, formattedAmount);
            
            // Get the current nonce and gas price
            const nonce = await this.web3.eth.getTransactionCount(this.account.address);
            const gasPrice = BigInt(await this.web3.eth.getGasPrice());
            const adjustedGasPrice = (gasPrice * BigInt(110) / BigInt(100)).toString(); // 10% higher
            
            // Estimate gas
            const estimatedGas = await mintTx.estimateGas({
                from: this.account.address
            });
            
            // Create transaction object
            const tx = {
                from: this.account.address,
                to: contractAddress,
                nonce: nonce,
                gas: Math.floor(Number(estimatedGas) * 1.2), // Add 20% buffer
                gasPrice: adjustedGasPrice,
                data: mintTx.encodeABI(),
                chainId: await this.web3.eth.getChainId()
            };
            
            // Sign and send the transaction
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            return {
                amount: amount,
                formattedAmount: formattedAmount,
                txHash: receipt.transactionHash,
                success: true
            };
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error minting tokens: ${error.message}`));
            return {
                amount: amount,
                success: false,
                error: error.message
            };
        }
    }
    
    async burnTokens(contractAddress, abi, amount, decimals) {
        try {
            // Create contract instance
            const contract = new this.web3.eth.Contract(abi, contractAddress);
            
            // Format the amount with decimals
            const formattedAmount = this.formatTokenAmount(amount, decimals).toString();
            
            // Prepare the burn transaction
            const burnTx = contract.methods.burn(formattedAmount);
            
            // Get the current nonce and gas price
            const nonce = await this.web3.eth.getTransactionCount(this.account.address);
            const gasPrice = BigInt(await this.web3.eth.getGasPrice());
            const adjustedGasPrice = (gasPrice * BigInt(110) / BigInt(100)).toString(); // 10% higher
            
            // Estimate gas
            const estimatedGas = await burnTx.estimateGas({
                from: this.account.address
            });
            
            // Create transaction object
            const tx = {
                from: this.account.address,
                to: contractAddress,
                nonce: nonce,
                gas: Math.floor(Number(estimatedGas) * 1.2), // Add 20% buffer
                gasPrice: adjustedGasPrice,
                data: burnTx.encodeABI(),
                chainId: await this.web3.eth.getChainId()
            };
            
            // Sign and send the transaction
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            return {
                amount: amount,
                formattedAmount: formattedAmount,
                txHash: receipt.transactionHash,
                success: true
            };
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error burning tokens: ${error.message}`));
            return {
                amount: amount,
                success: false,
                error: error.message
            };
        }
    }
    
    async executeTokenOperations() {
        if (!this.config.enable_erc20) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ ERC20 token operations disabled in config`));
            return true;
        }
        
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting ERC20 token operations...`));
        
        try {
            // Generate random token name and symbol
            const tokenName = this.generateRandomTokenName();
            const symbol = this.generateTokenSymbol(tokenName);
            const decimals = this.config.decimals || 18;
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Token: ${tokenName} (${symbol})`));
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Decimals: ${decimals}`));
            
            // Deploy token contract
            const deployedContract = await this.deployContract(tokenName, symbol, decimals);
            
            // Determine mint amount based on config
            const minMint = Math.max(1, this.config.mint_amount?.min || 1000000);
            const maxMint = Math.max(minMint, this.config.mint_amount?.max || 10000000);
            const mintAmount = Math.floor(Math.random() * (maxMint - minMint + 1)) + minMint;
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Will mint ${mintAmount.toLocaleString()} tokens...`));
            
            // Mint tokens
            const mintResult = await this.mintTokens(
                deployedContract.contractAddress,
                deployedContract.abi,
                mintAmount,
                decimals
            );
            
            if (mintResult.success) {
                console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Minted ${mintAmount.toLocaleString()} ${symbol} tokens: ${mintResult.txHash}`));
                
                // Determine burn amount based on config percentage
                const burnPercentage = Math.min(100, Math.max(0, this.config.burn_percentage || 10));
                const burnAmount = Math.floor(mintAmount * burnPercentage / 100);
                
                if (burnAmount > 0) {
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Burning ${burnAmount.toLocaleString()} tokens (${burnPercentage}% of minted)...`));
                    
                    // Small delay before burning
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    const burnResult = await this.burnTokens(
                        deployedContract.contractAddress,
                        deployedContract.abi,
                        burnAmount,
                        decimals
                    );
                    
                    if (burnResult.success) {
                        console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Burned ${burnAmount.toLocaleString()} ${symbol} tokens: ${burnResult.txHash}`));
                    } else {
                        console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to burn tokens: ${burnResult.error}`));
                    }
                } else {
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ No tokens to burn (burn percentage: ${burnPercentage}%)`));
                }
            } else {
                console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to mint tokens: ${mintResult.error}`));
            }
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ ERC20 token operations completed!`));
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Contract address: ${deployedContract.contractAddress}`));
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Token: ${tokenName} (${symbol})`));
            
            return true;
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error executing ERC20 token operations: ${error.message}`));
            return false;
        }
    }
}

module.exports = ERC20TokenDeployer;
