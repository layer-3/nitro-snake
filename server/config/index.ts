// Export configuration values
// export const BROKER_WS_URL = process.env.BROKER_WS_URL || 'wss://ethtaipei-production.up.railway.app/ws';
export const BROKER_WS_URL = 'ws://localhost:8000/ws'; // For local testing
// A proper random key for testing - DO NOT USE THIS IN PRODUCTION
export const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY || 'fb7b8df29a2d02c4d9e01075740c0653ba29f712b14d771f322c82fec90925d8';

// Contract addresses
export const CONTRACT_ADDRESSES = {
  custody: process.env.CUSTODY_ADDRESS || '0x1234567890123456789012345678901234567890',
  adjudicator: process.env.ADJUDICATOR_ADDRESS || '0x0987654321098765432109876543210987654321',
  guestAddress: process.env.GUEST_ADDRESS || '0x2345678901234567890123456789012345678901',
  tokenAddress: process.env.TOKEN_ADDRESS || '0x3456789012345678901234567890123456789012',
};
