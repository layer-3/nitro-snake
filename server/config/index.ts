// Export configuration values
// export const BROKER_WS_URL = process.env.BROKER_WS_URL || 'wss://ethtaipei-production.up.railway.app/ws';
export const BROKER_WS_URL = "https://ethtaipei-production.up.railway.app/ws"; // For local testing
// A proper random key for testing - DO NOT USE THIS IN PRODUCTION
export const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY || "fb7b8df29a2d02c4d9e01075740c0653ba29f712b14d771f322c82fec90925d8";

// Contract addresses
export const CONTRACT_ADDRESSES = {
    custody: process.env.CUSTODY_ADDRESS || "0x1096644156Ed58BF596e67d35827Adc97A25D940",
    adjudicator: process.env.ADJUDICATOR_ADDRESS || "0xa3f2f64455c9f8D68d9dCAeC2605D64680FaF898",
    tokenAddress: process.env.TOKEN_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
};
