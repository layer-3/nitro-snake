// Export configuration values
// export const BROKER_WS_URL = process.env.BROKER_WS_URL || 'wss://ethtaipei-production.up.railway.app/ws';
export const BROKER_WS_URL = 'ws://localhost:8000/ws'; // For local testing
// A proper random key for testing - DO NOT USE THIS IN PRODUCTION
export const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY || 'fb7b8df29a2d02c4d9e01075740c0653ba29f712b14d771f322c82fec90925d8';

// Contract addresses
export const CONTRACT_ADDRESSES = {
  custody: process.env.CUSTODY_ADDRESS || '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE', // script/Custody.s.sol
  adjudicator: process.env.ADJUDICATOR_ADDRESS || '0x68B1D87F95878fE05B998F19b66F4baba5De1aed', // adjudicator/Dummy.sol
  tokenAddress: process.env.TOKEN_ADDRESS || '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512',  // script/DeployFundERC20.s.sol
};
