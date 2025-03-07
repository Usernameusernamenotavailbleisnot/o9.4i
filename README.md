# 09.4i

## Overview

09.4i is a comprehensive automation tool for interacting with the 09.4i blockchain testnet. This tool helps developers and testers automate various blockchain operations including faucet claims, token transfers, file storage, smart contract deployment, NFT operations, ERC20 token management, token swaps, and the newly added NFT and domain minting.

## Features

- **Faucet Claims**: Automatically claim testnet tokens from faucets with captcha solving
- **Token Transfers**: Perform self-transfers to maintain wallet activity
- **Storage Operations**: Upload random files to blockchain storage
- **Smart Contract Deployment**: Deploy and interact with custom smart contracts
- **ERC20 Token Management**: Create, mint, and burn ERC20 tokens
- **NFT Operations**: Create NFT collections, mint NFTs, and burn tokens
- **Token Swaps**: Interact with DEX to swap between various tokens (USDT, BTC, ETH)
- **NFT Minting**: Mint NFTs from established collections
- **Domain Minting**: Register personalized domains on the blockchain
- **Proxy Support**: Rotate through proxy servers for distributed operations
- **Configurable Workflows**: Detailed configuration options via JSON

## Installation

```bash
# Clone the repository
git clone https://github.com/Usernameusernamenotavailbleisnot/o9.4i.git
cd 09.4i

# Install dependencies
npm install
```

## Configuration

The tool is configured via the `config.json` file. Here's an overview of the main configuration options:

```json
{
  "enable_faucet": true,           // Enable/disable faucet claiming
  "enable_transfer": true,         // Enable/disable token transfers
  "enable_storage": true,          // Enable/disable storage operations
  "gas_price_multiplier": 1.1,     // Gas price multiplier for faster confirmations
  "max_retries": 5,                // Maximum retry attempts for operations
  "base_wait_time": 10,            // Base wait time between retries
  "transfer_amount_percentage": 90, // Percentage of balance to transfer
  "storage_network": "turbo",      // Storage network to use
  "storage_config": {              // Storage-specific configuration
      "min_files": 2,
      "max_files": 3
  },
  "nft": { ... },                  // NFT operation configuration
  "contract": { ... },             // Contract deployment configuration
  "erc20": { ... },                // ERC20 token configuration
  "token_operations": { ... },     // Token swap configuration
  "mint_conf": { ... }             // Minting operations configuration
}
```

## Module Descriptions

### Core Functionality

- **index.js**: Main entry point that orchestrates all operations across wallets
- **EnhancedFaucetClaimer**: Claims tokens from faucets with captcha solving
- **StorageUploader**: Handles uploading files to blockchain storage

### Smart Contract Operations

- **src/deploy_contract.js**: Handles deployment and interaction with custom smart contracts
  - Compiles and deploys contracts with Solidity 0.8.x
  - Supports multiple interaction types (setValue, increment, decrement, reset, contribute)
  - Handles transaction signing, gas estimation, and receipt validation

### Token Operations

- **src/erc20_token.js**: Manages ERC20 token operations
  - Creates new ERC20 tokens with configurable parameters
  - Mints tokens to the wallet address
  - Burns tokens based on configured percentage
  - Generates random token names/symbols

- **src/token_swapper.js**: Handles token swap operations on DEX
  - Claims tokens from on-chain faucets
  - Approves tokens for swap operations
  - Executes token swaps between different pairs (USDT, BTC, ETH)
  - Handles transaction retries and confirmation waiting

### NFT Management

- **src/nft_manager.js**: Comprehensive NFT collection management
  - Creates new NFT collections with random names
  - Mints NFTs to the wallet address
  - Burns NFTs based on configured percentage
  - Generates token metadata and URIs

### New Minting Operations

- **src/mint_conf.js**: Mint NFTs and domains from established contracts
  - Mints NFTs from existing collections (e.g., Miner's Legacy)
  - Registers domain names using realistic people names
  - Supports customizable minting counts and retry logic
  - Generates domain names using the Faker library for realism

## Detailed Configuration Sections

### NFT and Domain Minting Configuration

```json
"mint_conf": {
    "enable_mint_nft": true,       // Enable/disable NFT minting
    "enable_mint_domain": true,    // Enable/disable domain minting
    "mint_nft": {
        "count": {
            "min": 1,              // Minimum NFTs to mint per wallet
            "max": 2               // Maximum NFTs to mint per wallet
        }
    },
    "mint_domain": {
        "count": {
            "min": 1,              // Minimum domains to mint per wallet
            "max": 2               // Maximum domains to mint per wallet
        },
        "name_length": {
            "min": 4,              // Minimum domain name length
            "max": 8               // Maximum domain name length
        }
    },
    "gas_price_multiplier": 1.1,   // Gas price multiplier for faster confirmations
    "max_retries": 2               // Maximum retry attempts for minting operations
}
```

### NFT Collection Creation Configuration

```json
"nft": {
    "enable_nft": true,            // Enable/disable NFT collection creation
    "mint_count": {
        "min": 2,                  // Minimum NFTs to mint for the collection
        "max": 10                  // Maximum NFTs to mint for the collection
    },
    "burn_percentage": 20,         // Percentage of minted NFTs to burn
    "supply": {
        "min": 100,                // Minimum total supply for the collection
        "max": 1000                // Maximum total supply for the collection
    }
}
```

### Token Swap Configuration

```json
"token_operations": {
    "enable_onchain_faucet": true,           // Enable/disable on-chain token faucets
    "enable_token_swap": true,               // Enable/disable token swaps
    "faucet_tokens": ["USDT", "BTC", "ETH"], // Tokens to claim from faucets
    "swap_pairs": [
        { "from": "USDT", "to": "BTC", "count": 2 }, // Swap pairs with count
        { "from": "USDT", "to": "ETH", "count": 2 }
    ],
    "swap_amounts": {                        // Amount ranges for each token
        "USDT": {
            "min": 0.01,
            "max": 0.1
        }
    }
}
```

## Setup

1. **Add Private Keys**: Add your private keys to `pk.txt`, one per line:
   ```
   0x1234567890abcdef...
   0x9876543210abcdef...
   ```

2. **Add Proxies (Optional)**: Add HTTP proxies to `proxy.txt`, one per line:
   ```
   http://user:password@ip:port
   http://user:password@ip:port
   ```

3. **Configure Operations**: Edit `config.json` to enable/disable specific operations.

## Usage

```bash
# Start the automation tool
npm start
```

The tool will process each wallet from the `pk.txt` file, performing the enabled operations as configured in `config.json`. The operations include:

1. Claiming tokens from faucets
2. Performing token transfers
3. Uploading files to blockchain storage
4. Deploying and interacting with smart contracts
5. Creating, minting, and burning ERC20 tokens
6. Creating NFT collections and minting/burning NFTs
7. Swapping tokens through DEX
8. Minting NFTs from established collections
9. Registering domain names

## Runtime Output

The tool provides detailed console output with color-coding:
- Green: Successful operations
- Red: Errors
- Yellow: Warnings
- Blue: Operation headings
- Cyan: Informational messages

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This tool is for educational and testing purposes only. Please use responsibly and in accordance with the terms of service of the networks you interact with.
