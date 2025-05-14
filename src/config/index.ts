// Export configuration values
export const BROKER_WS_URL = 'ws://localhost:8000/ws'; // For local testing

// Helper function to safely access environment variables
const getEnvVar = (key: string, defaultValue: string): string => {
  // In Vite, environment variables are exposed through import.meta.env
  // with the VITE_ prefix
  try {
    const envValue = (import.meta.env?.[`VITE_${key}`] ||
                     window?.__ENV__?.[key] ||
                     null) as string | null;
    return envValue || defaultValue;
  } catch (e) {
    console.warn(`Could not access environment variable ${key}, using default value`);
    return defaultValue;
  }
};

// Contract addresses
export const CONTRACT_ADDRESSES = {
  // Use safe dummy contract addresses with correct checksums
  custody: getEnvVar('CUSTODY_ADDRESS', '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE'), // script/Custody.s.sol
  adjudicator: getEnvVar('ADJUDICATOR_ADDRESS', '0x68B1D87F95878fE05B998F19b66F4baba5De1aed'), // adjudicator/Dummy.sol
  tokenAddress: getEnvVar('TOKEN_ADDRESS', '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512'), // script/DeployFundERC20.s.sol
  guestAddress: getEnvVar('GUEST_ADDRESS', '0x358Ff921D0F021d5c4fA33b2636d921663b0B6bc'), // based on private key in server/config/index.ts
};
