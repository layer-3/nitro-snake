import { ContractAddresses } from "@erc7824/nitrolite";
import { Hex } from "viem";

export const BROKER_WS_URL = process.env.BROKER_WS_URL || 'wss://ethtaipei-production.up.railway.app/ws';
// A proper random key for testing - DO NOT USE THIS IN PRODUCTION
export const SERVER_PRIVATE_KEY = (process.env.SERVER_PRIVATE_KEY || "0xfb7b8df29a2d02c4d9e01075740c0653ba29f712b14d771f322c82fec90925d8") as Hex;
export const WALLET_PRIVATE_KEY = (process.env.WALLET_PRIVATE_KEY || "0x44225977210c2bfd75285a9933c567fbe42498531c2218df48603cc150eed494") as Hex;
export const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL;
console.log(`POLYGON_RPC_URL: ${POLYGON_RPC_URL}`);

// Contract addresses
export const CONTRACT_ADDRESSES: ContractAddresses = {
    custody: (process.env.CUSTODY_ADDRESS || "0x1096644156Ed58BF596e67d35827Adc97A25D940") as Hex,
    adjudicator: (process.env.ADJUDICATOR_ADDRESS || "0xa3f2f64455c9f8D68d9dCAeC2605D64680FaF898") as Hex,
    tokenAddress: (process.env.TOKEN_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359") as Hex,
    guestAddress: (process.env.GUEST_ADDRESS || "0xd85F883a6B2e15BD3e1d6C939866CA95f802B396") as Hex, // broker channel address is used here
};
console.log("Contract addresses:", CONTRACT_ADDRESSES);
