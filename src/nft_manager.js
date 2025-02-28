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

// NFT name generators for popular web3/meme NFT style collections
const NFT_NAME_PREFIXES = [
    // Original list
    'Crypto', 'Bored', 'Mutant', 'Azuki', 'Doodle', 'Pudgy', 'Cool', 'Lazy', 'Cyber', 'Meta',
    'Pixel', 'Art', 'Punk', 'Moon', 'Ape', 'Chimp', 'Digital', 'Virtual', 'Token', 'Chain',
    'Meme', 'Pepe', 'Doge', 'Shib', 'Rare', 'Unique', 'Space', 'DeGen', 'Based', 'Alpha',
    
    // Additional NFT-focused prefixes
    'Yacht', 'Invisible', 'Alien', 'Robot', 'Zombie', 'Demon', 'Angel', 'God', 'Goddess', 'Wizard',
    'Witch', 'Warlock', 'Mage', 'Knight', 'Samurai', 'Ninja', 'Pirate', 'Viking', 'Cowboy', 'Astronaut',
    'Creepy', 'Cute', 'Silly', 'Funny', 'Happy', 'Sad', 'Angry', 'Chill', 'Hyped', 'Stoned',
    'Drunk', 'High', 'Low', 'Fast', 'Slow', 'Big', 'Small', 'Fat', 'Thin', 'Tall',
    'Short', 'Wide', 'Narrow', 'Deep', 'Shallow', 'Rich', 'Poor', 'Smart', 'Dumb', 'Wise',
    'Foolish', 'Brave', 'Cowardly', 'Strong', 'Weak', 'Tough', 'Soft', 'Hard', 'Gentle', 'Rough',
    'Smooth', 'Bumpy', 'Flat', 'Round', 'Square', 'Triangle', 'Circle', 'Rectangle', 'Oval', 'Diamond',
    '8Bit', '16Bit', 'Voxel', 'Anime', 'Manga', 'Comic', 'Cartoon', 'Realistic', 'Abstract', 'Surreal',
    'Impressionist', 'Expressionist', 'Cubist', 'Minimalist', 'Maximalist', 'Futurist', 'Retro', 'Vintage', 'Modern', 'Ancient',
    'Medieval', 'Renaissance', 'Baroque', 'Gothic', 'Victorian', 'Edwardian', 'Art Deco', 'Art Nouveau', 'Modernist', 'Postmodern'
];

const NFT_NAME_SUFFIXES = [
    // Original list
    'Apes', 'Monkeys', 'Punks', 'Cats', 'Dogs', 'Bears', 'Club', 'Society', 'Gang', 'Legends',
    'Collection', 'Worlds', 'Metaverse', 'Universe', 'Pets', 'Friends', 'Heroes', 'Squad', 'Crew', 'Team',
    'Tokens', 'NFTs', 'Assets', 'Items', 'Frens', 'Collectibles', 'Art', 'Yacht', 'League', 'Kingdom',
    
    // Additional NFT-focused suffixes
    'Clan', 'Tribe', 'Nation', 'Empire', 'Republic', 'Dominion', 'Realm', 'Dimension', 'Multiverse', 'Omniverse',
    'Collective', 'Cooperative', 'Alliance', 'Federation', 'Union', 'Coalition', 'Consortium', 'Syndicate', 'Cartel', 'Mafia',
    'Family', 'Brotherhood', 'Sisterhood', 'Fellowship', 'Circle', 'Ring', 'Guild', 'Lodge', 'Chapter', 'Order',
    'Cult', 'Covenant', 'Pact', 'Accord', 'Treaty', 'Council', 'Senate', 'Parliament', 'Congress', 'Assembly',
    'Gathering', 'Meeting', 'Summit', 'Convention', 'Conference', 'Symposium', 'Colloquium', 'Seminar', 'Workshop', 'Class',
    'Academy', 'School', 'College', 'University', 'Institute', 'Foundation', 'Association', 'Organization', 'Corporation', 'Enterprise',
    'Venture', 'Startup', 'Business', 'Company', 'Firm', 'Agency', 'Bureau', 'Office', 'Department', 'Division',
    'Factory', 'Industry', 'Workshop', 'Studio', 'Laboratory', 'Observatory', 'Sanctuary', 'Refuge', 'Haven', 'Paradise',
    'Utopia', 'Dystopia', 'Apocalypse', 'Wasteland', 'Frontier', 'Wilderness', 'Jungle', 'Forest', 'Desert', 'Tundra',
    'Mountain', 'Valley', 'Canyon', 'Gorge', 'Ravine', 'Plateau', 'Plain', 'Meadow', 'Field', 'Garden'
];

// NFT Contract template
const NFT_CONTRACT_TEMPLATE = `
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract {{CONTRACT_NAME}} {
    // Contract owner
    address public owner;
    
    // Collection info
    string public name;
    string public symbol;
    uint256 public maxSupply;
    uint256 public totalSupply;
    
    // Token mappings
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => string) private _tokenURIs;
    
    // Events
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Mint(address indexed to, uint256 indexed tokenId, string tokenURI);
    event Burn(address indexed from, uint256 indexed tokenId);
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the contract owner");
        _;
    }
    
    modifier tokenExists(uint256 tokenId) {
        require(_owners[tokenId] != address(0), "Token doesn't exist");
        _;
    }
    
    constructor(string memory _name, string memory _symbol, uint256 _maxSupply) {
        owner = msg.sender;
        name = _name;
        symbol = _symbol;
        maxSupply = _maxSupply;
        totalSupply = 0;
    }
    
    function mint(address to, uint256 tokenId, string memory tokenURI) public onlyOwner {
        require(to != address(0), "Cannot mint to zero address");
        require(_owners[tokenId] == address(0), "Token already exists");
        require(totalSupply < maxSupply, "Maximum supply reached");
        
        _owners[tokenId] = to;
        _balances[to]++;
        _tokenURIs[tokenId] = tokenURI;
        totalSupply++;
        
        emit Transfer(address(0), to, tokenId);
        emit Mint(to, tokenId, tokenURI);
    }
    
    function burn(uint256 tokenId) public tokenExists(tokenId) {
        address tokenOwner = _owners[tokenId];
        
        // Only token owner or contract owner can burn
        require(msg.sender == tokenOwner || msg.sender == owner, "Not authorized to burn");
        
        // Clear token data
        delete _tokenURIs[tokenId];
        delete _owners[tokenId];
        _balances[tokenOwner]--;
        totalSupply--;
        
        emit Transfer(tokenOwner, address(0), tokenId);
        emit Burn(tokenOwner, tokenId);
    }
    
    function tokenURI(uint256 tokenId) public view tokenExists(tokenId) returns (string memory) {
        return _tokenURIs[tokenId];
    }
    
    function ownerOf(uint256 tokenId) public view tokenExists(tokenId) returns (address) {
        return _owners[tokenId];
    }
    
    function balanceOf(address _owner) public view returns (uint256) {
        require(_owner != address(0), "Zero address has no balance");
        return _balances[_owner];
    }
    
    function tokensOfOwner(address _owner) public view returns (uint256[] memory) {
        uint256 tokenCount = _balances[_owner];
        uint256[] memory tokenIds = new uint256[](tokenCount);
        
        uint256 counter = 0;
        for (uint256 i = 0; i < maxSupply && counter < tokenCount; i++) {
            if (_owners[i] == _owner) {
                tokenIds[counter] = i;
                counter++;
            }
        }
        
        return tokenIds;
    }
}
`;

class NFTManager {
    constructor(privateKey, config = {}) {
        // Default NFT configuration
        this.defaultConfig = {
            enable_nft: true,
            mint_count: {
                min: 2,
                max: 10
            },
            burn_percentage: 20,
            supply: {
                min: 100,
                max: 1000
            }
        };
        
        // Load configuration
        this.config = { ...this.defaultConfig, ...config.nft };
        
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
    
    generateRandomNFTName() {
        const prefix = NFT_NAME_PREFIXES[Math.floor(Math.random() * NFT_NAME_PREFIXES.length)];
        const suffix = NFT_NAME_SUFFIXES[Math.floor(Math.random() * NFT_NAME_SUFFIXES.length)];
        return `${prefix} ${suffix}`;
    }
    
    generateRandomNFTSymbol(name) {
        // Create a symbol from the first letters of each word in the name
        return name.split(' ')
            .map(word => word.charAt(0).toUpperCase())
            .join('');
    }
    
    async compileContract(contractName) {
        const spinner = ora(`Compiling NFT contract (${contractName})...`).start();
        
        try {
            // Replace placeholder in template with actual contract name
            const contractSource = NFT_CONTRACT_TEMPLATE.replace(/{{CONTRACT_NAME}}/g, contractName);
            
            // Setup compiler input with specific EVM version to ensure compatibility
            const input = {
                language: 'Solidity',
                sources: {
                    'NFTContract.sol': {
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
            const contract = output.contracts['NFTContract.sol'][contractName];
            
            spinner.succeed('NFT contract compiled successfully!');
            
            return {
                abi: contract.abi,
                bytecode: contract.evm.bytecode.object
            };
        } catch (error) {
            spinner.fail(`Failed to compile contract: ${error.message}`);
            throw error;
        }
    }
    
    async deployContract(contractName, symbol, maxSupply) {
        const spinner = ora(`Deploying NFT contract "${contractName}" (${symbol})...`).start();
        
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
                arguments: [contractName, symbol, maxSupply]
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
            
            spinner.succeed(`NFT contract deployed at: ${receipt.contractAddress}`);
            
            return {
                contractAddress: receipt.contractAddress,
                abi: compiledContract.abi,
                name: contractName,
                symbol: symbol,
                txHash: receipt.transactionHash
            };
        } catch (error) {
            spinner.fail(`Failed to deploy contract: ${error.message}`);
            throw error;
        }
    }
    
    generateTokenMetadata(tokenId, collectionName) {
        // Generate random attributes
        const rarities = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
        const rarity = rarities[Math.floor(Math.random() * rarities.length)];
        
        const categories = ['Art', 'Collectible', 'Game', 'Meme', 'PFP', 'Utility'];
        const category = categories[Math.floor(Math.random() * categories.length)];
        
        // Generate metadata
        const metadata = {
            name: `${collectionName} #${tokenId}`,
            description: `A unique NFT from the ${collectionName} collection.`,
            image: `https://placekitten.com/400/${400 + (tokenId % 100)}`, // Placeholder image URL
            attributes: [
                {
                    trait_type: 'Rarity',
                    value: rarity
                },
                {
                    trait_type: 'Category',
                    value: category
                },
                {
                    trait_type: 'Token ID',
                    value: tokenId.toString()
                },
                {
                    trait_type: 'Generation',
                    value: 'Genesis'
                }
            ]
        };
        
        // In a real application, you would upload this to IPFS or a similar service
        // For this example, we'll encode it as a data URI
        return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
    }
    
    async mintNFT(contractAddress, abi, tokenId, tokenURI) {
        try {
            // Create contract instance
            const contract = new this.web3.eth.Contract(abi, contractAddress);
            
            // Prepare the mint transaction
            const mintTx = contract.methods.mint(this.account.address, tokenId, tokenURI);
            
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
                tokenId,
                txHash: receipt.transactionHash,
                success: true
            };
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error minting NFT ${tokenId}: ${error.message}`));
            return {
                tokenId,
                success: false,
                error: error.message
            };
        }
    }
    
    async burnNFT(contractAddress, abi, tokenId) {
        try {
            // Create contract instance
            const contract = new this.web3.eth.Contract(abi, contractAddress);
            
            // Make sure we own this token
            const tokenOwner = await contract.methods.ownerOf(tokenId).call();
            if (tokenOwner.toLowerCase() !== this.account.address.toLowerCase()) {
                throw new Error(`Token ${tokenId} not owned by this wallet`);
            }
            
            // Prepare the burn transaction
            const burnTx = contract.methods.burn(tokenId);
            
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
                tokenId,
                txHash: receipt.transactionHash,
                success: true
            };
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error burning NFT ${tokenId}: ${error.message}`));
            return {
                tokenId,
                success: false,
                error: error.message
            };
        }
    }
    
    async executeNFTOperations() {
        if (!this.config.enable_nft) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ NFT operations disabled in config`));
            return true;
        }
        
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Starting NFT operations...`));
        
        try {
            // Generate random NFT collection name and symbol
            const collectionName = this.generateRandomNFTName();
            const symbol = this.generateRandomNFTSymbol(collectionName);
            
            // Generate random max supply
            const minSupply = Math.max(10, this.config.supply.min || 100);
            const maxSupply = Math.max(minSupply, this.config.supply.max || 1000);
            const supply = Math.floor(Math.random() * (maxSupply - minSupply + 1)) + minSupply;
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ NFT Collection: ${collectionName} (${symbol})`));
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Max Supply: ${supply}`));
            
            // Deploy contract
            const deployedContract = await this.deployContract(collectionName, symbol, supply);
            
            // Determine mint count based on config
            const minMint = Math.max(1, this.config.mint_count.min || 2);
            const maxMint = Math.min(supply, Math.max(minMint, this.config.mint_count.max || 10));
            const mintCount = Math.floor(Math.random() * (maxMint - minMint + 1)) + minMint;
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Will mint ${mintCount} NFTs...`));
            
            // Mint NFTs
            const mintedTokens = [];
            for (let i = 0; i < mintCount; i++) {
                const tokenId = i;
                const tokenURI = this.generateTokenMetadata(tokenId, collectionName);
                
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Minting token #${tokenId}...`));
                const mintResult = await this.mintNFT(
                    deployedContract.contractAddress,
                    deployedContract.abi,
                    tokenId,
                    tokenURI
                );
                
                if (mintResult.success) {
                    mintedTokens.push(tokenId);
                    console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Token #${tokenId} minted successfully: ${mintResult.txHash}`));
                } else {
                    console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to mint token #${tokenId}: ${mintResult.error}`));
                }
                
                // Small delay between mints
                if (i < mintCount - 1) {
                    const delay = Math.random() * 2000 + 1000; // 1-3 second delay
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            // Determine burn count based on config percentage
            const burnPercentage = Math.min(100, Math.max(0, this.config.burn_percentage || 20));
            const burnCount = Math.ceil(mintedTokens.length * burnPercentage / 100);
            
            if (burnCount > 0 && mintedTokens.length > 0) {
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Burning ${burnCount} NFTs (${burnPercentage}% of minted)...`));
                
                // Randomly select tokens to burn
                const tokensToBurn = [...mintedTokens]
                    .sort(() => Math.random() - 0.5) // Shuffle
                    .slice(0, burnCount);
                
                for (const tokenId of tokensToBurn) {
                    console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Burning token #${tokenId}...`));
                    const burnResult = await this.burnNFT(
                        deployedContract.contractAddress,
                        deployedContract.abi,
                        tokenId
                    );
                    
                    if (burnResult.success) {
                        console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Token #${tokenId} burned successfully: ${burnResult.txHash}`));
                    } else {
                        console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Failed to burn token #${tokenId}: ${burnResult.error}`));
                    }
                    
                    // Small delay between burns
                    if (tokenId !== tokensToBurn[tokensToBurn.length - 1]) {
                        const delay = Math.random() * 1500 + 1000; // 1-2.5 second delay
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            } else {
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ No tokens to burn (burn percentage: ${burnPercentage}%)`));
            }
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ NFT operations completed successfully!`));
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Contract address: ${deployedContract.contractAddress}`));
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Total minted: ${mintedTokens.length}, Burned: ${burnCount}`));
            
            return true;
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error executing NFT operations: ${error.message}`));
            return false;
        }
    }
}

module.exports = NFTManager;
