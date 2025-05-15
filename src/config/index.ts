// Export configuration values
export const BROKER_WS_URL = "wss://ethtaipei-production.up.railway.app/ws";
export const GAMESERVER_WS_URL = "ws://localhost:3001";

// Helper function to safely access environment variables
const getEnvVar = (key: string, defaultValue: string): string => {
    // In Vite, environment variables are exposed through import.meta.env
    // with the VITE_ prefix
    try {
        const envValue = (import.meta.env?.[`VITE_${key}`] || window?.__ENV__?.[key] || null) as string | null;
        return envValue || defaultValue;
    } catch (e) {
        console.warn(`Could not access environment variable ${key}, using default value`);
        return defaultValue;
    }
};

// Contract addresses
export const CONTRACT_ADDRESSES = {
    // Use safe dummy contract addresses with correct checksums
    custody: getEnvVar("CUSTODY_ADDRESS", "0x1096644156Ed58BF596e67d35827Adc97A25D940"),
    adjudicator: getEnvVar("ADJUDICATOR_ADDRESS", "0xa3f2f64455c9f8D68d9dCAeC2605D64680FaF898"),
    tokenAddress: getEnvVar("TOKEN_ADDRESS", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
    guestAddress: getEnvVar("GUEST_ADDRESS", "0x3c93C321634a80FB3657CFAC707718A11cA57cBf"),
};
