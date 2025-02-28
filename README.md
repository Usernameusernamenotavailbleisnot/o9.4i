# 09.4i

## Overview

09.4i is a comprehensive automation tool for interacting with the 09.4i blockchain testnet. This tool helps developers and testers automate various blockchain operations including faucet claims, token transfers, file storage, smart contract deployment, NFT operations, ERC20 token management, and token swaps.

## Features

- **Faucet Claims**: Automatically claim testnet tokens from faucets with captcha solving
- **Token Transfers**: Perform self-transfers to maintain wallet activity
- **Storage Operations**: Upload random files to blockchain storage
- **Smart Contract Deployment**: Deploy and interact with custom smart contracts
- **ERC20 Token Management**: Create, mint, and burn ERC20 tokens
- **NFT Operations**: Create NFT collections, mint NFTs, and burn tokens
- **Token Swaps**: Interact with DEX to swap between various tokens (USDT, BTC, ETH)
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
  "token_operations": { ... }      // Token swap configuration
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

## Smart Contract Operations

The tool supports deploying and interacting with various types of smart contracts:

- **Basic contracts**: Simple contracts with state variables
- **ERC20 tokens**: Fungible token contracts with customizable parameters
- **NFT collections**: Non-fungible token contracts with minting and burning capabilities

## Advanced Configuration

### Token Swap Configuration

```json
"token_operations": {
    "enable_onchain_faucet": true,
    "enable_token_swap": true,
    "faucet_tokens": ["USDT", "BTC", "ETH"],
    "swap_pairs": [
        { "from": "USDT", "to": "BTC", "count": 2 },
        { "from": "USDT", "to": "ETH", "count": 2 }
    ],
    "swap_amounts": {
        "USDT": {
            "min": 0.01,
            "max": 0.1
        }
    }
}
```

### NFT Configuration

```json
"nft": {
    "enable_nft": true,
    "mint_count": {
        "min": 2,
        "max": 10
    },
    "burn_percentage": 20,
    "supply": {
        "min": 100,
        "max": 1000
    }
}
```

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
