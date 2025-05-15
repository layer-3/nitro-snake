// Export configuration values
export const BROKER_WS_URL = "https://ethtaipei-production.up.railway.app/ws"; // For local testing

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
    custody: getEnvVar("CUSTODY_ADDRESS", "0x1096644156Ed58BF596e67d35827Adc97A25D940"), // script/Custody.s.sol
    adjudicator: getEnvVar("ADJUDICATOR_ADDRESS", "0xa3f2f64455c9f8D68d9dCAeC2605D64680FaF898"), // adjudicator/Dummy.sol
    tokenAddress: getEnvVar("TOKEN_ADDRESS", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"), // script/DeployFundERC20.s.sol
    guestAddress: getEnvVar("GUEST_ADDRESS", "0x3c93C321634a80FB3657CFAC707718A11cA57cBf"), // based on private key in server/config/index.ts
};
