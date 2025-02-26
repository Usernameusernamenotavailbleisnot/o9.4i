const { Web3 } = require('web3');
const fs = require('fs').promises;
const chalk = require('chalk');
const ora = require('ora');
const solc = require('solc');
const path = require('path');
const crypto = require('crypto');

function getTimestamp(walletNum = null) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    if (walletNum !== null) {
        return `[${timestamp} - Wallet ${walletNum}]`;
    }
    return `[${timestamp}]`;
}

// Simple sample contract with interaction methods
const SAMPLE_CONTRACT_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract InteractiveContract {
    address public owner;
    uint256 public value;
    uint256 public interactionCount;
    string public lastAction;
    mapping(address => uint256) public contributions;
    
    event ValueUpdated(address indexed by, uint256 newValue, string actionType);
    event Contributed(address indexed contributor, uint256 amount);
    
    constructor() {
        owner = msg.sender;
        value = 0;
        interactionCount = 0;
        lastAction = "Contract created";
    }
    
    function setValue(uint256 _value) public {
        value = _value;
        interactionCount++;
        lastAction = "setValue";
        emit ValueUpdated(msg.sender, _value, "setValue");
    }
    
    function increment() public {
        value++;
        interactionCount++;
        lastAction = "increment";
        emit ValueUpdated(msg.sender, value, "increment");
    }
    
    function decrement() public {
        if (value > 0) {
            value--;
        }
        interactionCount++;
        lastAction = "decrement";
        emit ValueUpdated(msg.sender, value, "decrement");
    }
    
    function contribute() public payable {
        require(msg.value > 0, "Contribution must be greater than 0");
        contributions[msg.sender] += msg.value;
        interactionCount++;
        lastAction = "contribute";
        emit Contributed(msg.sender, msg.value);
    }
    
    function getStats() public view returns (uint256, uint256, string memory) {
        return (value, interactionCount, lastAction);
    }
    
    function reset() public {
        require(msg.sender == owner, "Only owner can reset");
        value = 0;
        interactionCount++;
        lastAction = "reset";
        emit ValueUpdated(msg.sender, 0, "reset");
    }
}
`;

class ContractDeployer {
    constructor(privateKey, config = {}) {
        // Default configuration
        this.defaultConfig = {
            enable_contract_deploy: true,
            contract_interactions: {
                enabled: true,
                count: {
                    min: 3,
                    max: 8
                },
                types: ["setValue", "increment", "decrement", "reset"]
            },
            gas_price_multiplier: 1.1
        };
        
        // Load configuration, merging with defaults
        this.config = { ...this.defaultConfig, ...config };
        
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
    
    async compileContract() {
        const spinner = ora('Compiling smart contract...').start();
        
        try {
            // Setup compiler input with specific EVM version to ensure compatibility
            const input = {
                language: 'Solidity',
                sources: {
                    'Contract.sol': {
                        content: SAMPLE_CONTRACT_SOURCE
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
            const contract = output.contracts['Contract.sol']['InteractiveContract'];
            
            spinner.succeed('Contract compiled successfully!');
            
            return {
                abi: contract.abi,
                bytecode: contract.evm.bytecode.object
            };
        } catch (error) {
            spinner.fail(`Failed to compile contract: ${error.message}`);
            throw error;
        }
    }
    
    async deployContract(compiledContract) {
        const spinner = ora('Deploying smart contract...').start();
        
        try {
            // Create contract instance for deployment
            const contract = new this.web3.eth.Contract(compiledContract.abi);
            
            // Prepare deployment transaction
            const deployTx = contract.deploy({
                data: '0x' + compiledContract.bytecode,
                arguments: []
            });
            
            // Get gas price with multiplier for faster confirmation
            const gasPrice = BigInt(await this.web3.eth.getGasPrice());
            const adjustedGasPrice = (gasPrice * BigInt(Math.floor(this.config.gas_price_multiplier * 100)) / BigInt(100)).toString();
            
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
            
            spinner.succeed(`Contract deployed at: ${receipt.contractAddress}`);
            
            return {
                contractAddress: receipt.contractAddress,
                abi: compiledContract.abi,
                txHash: receipt.transactionHash
            };
        } catch (error) {
            spinner.fail(`Failed to deploy contract: ${error.message}`);
            throw error;
        }
    }
    
    async interactWithContract(contractAddress, abi, interactionType) {
        try {
            // Create contract instance
            const contract = new this.web3.eth.Contract(abi, contractAddress);
            
            // Prepare the interaction based on type
            let method;
            let methodArgs = [];
            let value = '0';
            
            switch (interactionType) {
                case 'setValue':
                    const randomValue = Math.floor(Math.random() * 1000);
                    method = contract.methods.setValue(randomValue);
                    break;
                    
                case 'increment':
                    method = contract.methods.increment();
                    break;
                    
                case 'decrement':
                    method = contract.methods.decrement();
                    break;
                    
                case 'reset':
                    method = contract.methods.reset();
                    break;
                    
                case 'contribute':
                    method = contract.methods.contribute();
                    value = this.web3.utils.toWei('0.00001', 'ether'); // Small contribution
                    break;
                    
                default:
                    throw new Error(`Unknown interaction type: ${interactionType}`);
            }
            
            // Get the current nonce and gas price
            const nonce = await this.web3.eth.getTransactionCount(this.account.address);
            const gasPrice = BigInt(await this.web3.eth.getGasPrice());
            const adjustedGasPrice = (gasPrice * BigInt(Math.floor(this.config.gas_price_multiplier * 100)) / BigInt(100)).toString();
            
            // Estimate gas
            const estimatedGas = await method.estimateGas({
                from: this.account.address,
                value: value
            });
            
            // Create transaction object
            const tx = {
                from: this.account.address,
                to: contractAddress,
                nonce: nonce,
                gas: Math.floor(Number(estimatedGas) * 1.2), // Add 20% buffer
                gasPrice: adjustedGasPrice,
                data: method.encodeABI(),
                value: value,
                chainId: await this.web3.eth.getChainId()
            };
            
            // Sign and send the transaction
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            return {
                type: interactionType,
                txHash: receipt.transactionHash,
                success: true
            };
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error with interaction ${interactionType}: ${error.message}`));
            return {
                type: interactionType,
                success: false,
                error: error.message
            };
        }
    }
    
    async executeContractOperations() {
        if (!this.config.enable_contract_deploy) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Contract deployment disabled in config`));
            return true;
        }
        
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting contract operations...`));
        
        try {
            // Step 1: Compile the contract
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Compiling smart contract...`));
            const compiledContract = await this.compileContract();
            
            // Step 2: Deploy the contract
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Deploying smart contract...`));
            const deployedContract = await this.deployContract(compiledContract);
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Contract deployed at: ${deployedContract.contractAddress}`));
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Transaction hash: ${deployedContract.txHash}`));
            
            // Skip interactions if disabled in config
            if (!this.config.contract_interactions?.enabled) {
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Contract interactions disabled in config`));
                return true;
            }
            
            // Step 3: Interact with the contract multiple times
            // Get interaction count from config, handling both object and direct value format
            let minInteractions = 3;
            let maxInteractions = 8;
            
            if (this.config.contract_interactions?.count) {
                if (typeof this.config.contract_interactions.count === 'object') {
                    // Using min/max format
                    minInteractions = Math.max(1, this.config.contract_interactions.count.min || 3);
                    maxInteractions = Math.max(minInteractions, this.config.contract_interactions.count.max || 8);
                } else {
                    // Using direct value format (for backward compatibility)
                    minInteractions = maxInteractions = this.config.contract_interactions.count;
                }
            }
            
            // Determine random interaction count between min and max
            const interactionCount = Math.floor(Math.random() * (maxInteractions - minInteractions + 1)) + minInteractions;
            
            const interactionTypes = this.config.contract_interactions?.types || ["setValue", "increment", "decrement", "reset"];
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Will perform ${interactionCount} interactions with contract (min: ${minInteractions}, max: ${maxInteractions})...`));
            
            let successCount = 0;
            for (let i = 0; i < interactionCount; i++) {
                // Select a random interaction type from the available types
                const interactionType = interactionTypes[Math.floor(Math.random() * interactionTypes.length)];
                
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Interaction ${i+1}/${interactionCount}: ${interactionType}...`));
                
                const result = await this.interactWithContract(
                    deployedContract.contractAddress,
                    deployedContract.abi,
                    interactionType
                );
                
                if (result.success) {
                    console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ ${interactionType} successful: ${result.txHash}`));
                    successCount++;
                } else {
                    console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ ${interactionType} failed: ${result.error}`));
                }
                
                // Small delay between interactions
                if (i < interactionCount - 1) {
                    const delay = Math.random() * 2000 + 1000; // 1-3 second delay
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Contract operations completed: ${successCount}/${interactionCount} successful interactions`));
            return true;
            
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error in contract operations: ${error.message}`));
            return false;
        }
    }
}    
module.exports = ContractDeployer;
