/**
 * Cryptocurrency transaction verification service
 *
 * Verifies payments on any EVM chain, Bitcoin, Solana, and Tron by querying
 * public RPCs / APIs. Each verifier checks that the tx sent funds to
 * our receive address and returns structured payment details.
 */

// --- Type definitions ---

export interface VerifiedPayment {
  chain: string;
  txHash: string;
  fromAddress: string;
  token: string; // "ETH", "USDC", "USDT", "BTC", "SOL", "TRX", or "base:0xabcd..." for unknown ERC-20s
  amount: string; // standard units (e.g. "0.5" ETH, "100" USDC)
  confirmed: boolean;
  confirmations: number;
  contractAddress?: string; // ERC-20 contract address (if applicable)
}

// --- Receive addresses ---

const ADDRESSES = {
  ethereum: "0x0687cC26060FE12Fd4A6210c2f30Cf24a9853C6b",
  bitcoin: "bc1qa2wlapdsmf0pp8x3gamp6elaaehkarpgdre5vq",
  solana: "9npQZwDxDAcbnpVpQKzKYtLDKN8xpAMfE5FSAuSGsaJh",
  tron: "TRNx7dZXm2HNqaUp9oLTSLBhN4tHmsyUfL",
};

// --- EVM chain configuration ---

const EVM_CHAINS: Record<string, { rpcs: string[]; coingeckoId: string; nativeToken: string; nativeDecimals: number }> = {
  ethereum: { rpcs: ["https://eth.llamarpc.com", "https://rpc.ankr.com/eth"], coingeckoId: "ethereum", nativeToken: "ETH", nativeDecimals: 18 },
  base: { rpcs: ["https://mainnet.base.org", "https://base.llamarpc.com"], coingeckoId: "base", nativeToken: "ETH", nativeDecimals: 18 },
  arbitrum: { rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.llamarpc.com"], coingeckoId: "arbitrum-one", nativeToken: "ETH", nativeDecimals: 18 },
  polygon: { rpcs: ["https://polygon-rpc.com", "https://polygon.llamarpc.com"], coingeckoId: "polygon-pos", nativeToken: "POL", nativeDecimals: 18 },
  optimism: { rpcs: ["https://mainnet.optimism.io", "https://optimism.llamarpc.com"], coingeckoId: "optimism", nativeToken: "ETH", nativeDecimals: 18 },
  avalanche: { rpcs: ["https://api.avax.network/ext/bc/C/rpc", "https://avax.llamarpc.com"], coingeckoId: "avalanche", nativeToken: "AVAX", nativeDecimals: 18 },
  bnb: { rpcs: ["https://bsc-dataseed.binance.org", "https://binance.llamarpc.com"], coingeckoId: "binance-smart-chain", nativeToken: "BNB", nativeDecimals: 18 },
  linea: { rpcs: ["https://rpc.linea.build"], coingeckoId: "linea", nativeToken: "ETH", nativeDecimals: 18 },
  zksync: { rpcs: ["https://mainnet.era.zksync.io"], coingeckoId: "zksync", nativeToken: "ETH", nativeDecimals: 18 },
  scroll: { rpcs: ["https://rpc.scroll.io"], coingeckoId: "scroll", nativeToken: "ETH", nativeDecimals: 18 },
  mantle: { rpcs: ["https://rpc.mantle.xyz"], coingeckoId: "mantle", nativeToken: "MNT", nativeDecimals: 18 },
  blast: { rpcs: ["https://rpc.blast.io"], coingeckoId: "blast", nativeToken: "ETH", nativeDecimals: 18 },
  celo: { rpcs: ["https://forno.celo.org"], coingeckoId: "celo", nativeToken: "CELO", nativeDecimals: 18 },
  gnosis: { rpcs: ["https://rpc.gnosischain.com"], coingeckoId: "xdai", nativeToken: "xDAI", nativeDecimals: 18 },
  fantom: { rpcs: ["https://rpc.ftm.tools"], coingeckoId: "fantom", nativeToken: "FTM", nativeDecimals: 18 },
  mode: { rpcs: ["https://mainnet.mode.network"], coingeckoId: "mode", nativeToken: "ETH", nativeDecimals: 18 },
};

export const SUPPORTED_EVM_CHAINS = Object.keys(EVM_CHAINS);

/** Get the CoinGecko platform ID for an EVM chain (for token price lookups) */
export function getEvmChainCoingeckoId(chain: string): string | undefined {
  return EVM_CHAINS[chain]?.coingeckoId;
}

// --- Well-known ERC-20 tokens per chain ---

const WELL_KNOWN_TOKENS: Record<string, Record<string, { symbol: string; decimals: number }>> = {
  ethereum: {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  },
  base: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  },
  arbitrum: {
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", decimals: 6 },
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { symbol: "USDT", decimals: 6 },
  },
  polygon: {
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { symbol: "USDC", decimals: 6 },
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": { symbol: "USDT", decimals: 6 },
  },
  optimism: {
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": { symbol: "USDC", decimals: 6 },
    "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": { symbol: "USDT", decimals: 6 },
  },
  avalanche: {
    "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": { symbol: "USDC", decimals: 6 },
    "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7": { symbol: "USDT", decimals: 6 },
  },
  bnb: {
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": { symbol: "USDC", decimals: 18 },
    "0x55d398326f99059ff775485246999027b3197955": { symbol: "USDT", decimals: 18 },
  },
};

// --- ERC-20 Transfer event topic ---

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// --- Helpers ---

function hexToDecimal(hex: string): bigint {
  return BigInt(hex);
}

function weiToUnits(wei: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = wei / divisor;
  const frac = wei % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function tokenUnits(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function addressFromTopic(topic: string): string {
  // topics[1] and topics[2] are 32-byte padded addresses
  return "0x" + topic.slice(26).toLowerCase();
}

// --- EVM RPC helper ---

async function evmRpcCall(
  rpcs: string[],
  method: string,
  params: unknown[],
): Promise<unknown> {
  let lastError: Error | null = null;
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
      });
      const json = (await res.json()) as {
        result?: unknown;
        error?: { message: string };
      };
      if (json.error) throw new Error(`RPC error: ${json.error.message}`);
      return json.result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("All RPCs failed");
}

// --- ERC-20 metadata lookup ---

async function fetchErc20Metadata(
  rpcs: string[],
  contractAddress: string,
): Promise<{ symbol: string; decimals: number }> {
  let decimals = 18;
  let symbol = contractAddress;

  // Try to call decimals() — method sig 0x313ce567
  try {
    const decResult = await evmRpcCall(rpcs, "eth_call", [
      { to: contractAddress, data: "0x313ce567" },
      "latest",
    ]);
    if (decResult && typeof decResult === "string" && decResult !== "0x") {
      decimals = Number(BigInt(decResult));
    }
  } catch {
    // default to 18
  }

  // Try to call symbol() — method sig 0x95d89b41
  try {
    const symResult = await evmRpcCall(rpcs, "eth_call", [
      { to: contractAddress, data: "0x95d89b41" },
      "latest",
    ]);
    if (symResult && typeof symResult === "string" && symResult.length > 2) {
      // ABI-encoded string: offset (32 bytes) + length (32 bytes) + data
      const hex = symResult.slice(2);
      if (hex.length >= 128) {
        const len = Number(BigInt("0x" + hex.slice(64, 128)));
        if (len > 0 && len < 32) {
          const strHex = hex.slice(128, 128 + len * 2);
          const decoded = Buffer.from(strHex, "hex").toString("utf8").replace(/\0/g, "");
          if (decoded.length > 0) {
            symbol = decoded;
          }
        }
      }
    }
  } catch {
    // use contract address as symbol
  }

  return { symbol, decimals };
}

// --- EVM verification (any chain) ---

export async function verifyEvmTx(
  chain: string,
  txHash: string,
): Promise<VerifiedPayment> {
  const chainConfig = EVM_CHAINS[chain];
  if (!chainConfig) {
    throw new Error(`Unknown EVM chain: ${chain}`);
  }

  const rpcs = chainConfig.rpcs;

  // Fetch tx, receipt, and current block in parallel
  const [txRaw, receiptRaw, blockNumRaw] = await Promise.all([
    evmRpcCall(rpcs, "eth_getTransactionByHash", [txHash]),
    evmRpcCall(rpcs, "eth_getTransactionReceipt", [txHash]),
    evmRpcCall(rpcs, "eth_blockNumber", []),
  ]);

  const tx = txRaw as {
    from: string;
    to: string | null;
    value: string;
    blockNumber: string | null;
  } | null;

  const receipt = receiptRaw as {
    status: string;
    blockNumber: string;
    logs: Array<{
      address: string;
      topics: string[];
      data: string;
    }>;
  } | null;

  if (!tx) throw new Error(`${chain} tx not found: ${txHash}`);
  if (!receipt) throw new Error(`${chain} tx receipt not found (pending?): ${txHash}`);

  // Reject reverted transactions. A tx can carry a Transfer log / value and still
  // revert; status "0x1" (or "0x01") means success. Some very old chains omit
  // status entirely, in which case we cannot assert and fall through.
  if (
    receipt.status !== undefined &&
    receipt.status !== "0x1" &&
    receipt.status !== "0x01"
  ) {
    throw new Error(`${chain} tx reverted (status ${receipt.status}): ${txHash}`);
  }

  const currentBlock = hexToDecimal(blockNumRaw as string);
  const txBlock = hexToDecimal(receipt.blockNumber);
  const confirmations = Number(currentBlock - txBlock);
  const ourAddr = ADDRESSES.ethereum.toLowerCase();

  // Check for ERC-20 Transfer events to our address
  const wellKnown = WELL_KNOWN_TOKENS[chain] ?? {};

  for (const log of receipt.logs) {
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;

    const toAddr = addressFromTopic(log.topics[2]);
    if (toAddr !== ourAddr) continue;

    const contractAddr = log.address.toLowerCase();
    const amount = hexToDecimal(log.data);

    // Check well-known tokens first
    const known = wellKnown[contractAddr];
    if (known) {
      if (confirmations < 1) {
        throw new Error(
          `${chain} ${known.symbol} tx has ${confirmations} confirmations (need >=1)`,
        );
      }

      return {
        chain,
        txHash,
        fromAddress: tx.from,
        token: known.symbol,
        amount: tokenUnits(amount, known.decimals),
        confirmed: true,
        confirmations,
        contractAddress: contractAddr,
      };
    }

    // Unknown ERC-20 — try to fetch metadata from chain (used only for decimals)
    const metadata = await fetchErc20Metadata(rpcs, contractAddr);

    if (confirmations < 1) {
      throw new Error(
        `${chain} ERC-20 tx has ${confirmations} confirmations (need >=1)`,
      );
    }

    // SECURITY: never trust the on-chain symbol() string for pricing. An attacker
    // can deploy a worthless token whose symbol() returns "USDC" and have it valued
    // at $1/unit. For any contract not in WELL_KNOWN_TOKENS, we identify the token
    // purely by its chain-prefixed contract address, forcing toUsdCents() to price
    // it via an authoritative contract-address lookup (which returns nothing for a
    // valueless token) instead of the trusted-stablecoin shortcut.
    const tokenName = `${chain}:${contractAddr}`;

    return {
      chain,
      txHash,
      fromAddress: tx.from,
      token: tokenName,
      amount: tokenUnits(amount, metadata.decimals),
      confirmed: true,
      confirmations,
      contractAddress: contractAddr,
    };
  }

  // Native token transfer
  if (!tx.to || tx.to.toLowerCase() !== ourAddr) {
    throw new Error(
      `${chain} tx recipient ${tx.to} does not match our address ${ADDRESSES.ethereum}`,
    );
  }

  const value = hexToDecimal(tx.value);
  if (value === 0n) {
    throw new Error(`${chain} tx has zero value and no matching ERC-20 transfer`);
  }

  // Native tokens on most chains need fewer confirmations than ETH mainnet
  const minConfirmations = chain === "ethereum" ? 12 : 1;
  if (confirmations < minConfirmations) {
    throw new Error(
      `${chain} ${chainConfig.nativeToken} tx has ${confirmations} confirmations (need >=${minConfirmations})`,
    );
  }

  return {
    chain,
    txHash,
    fromAddress: tx.from,
    token: chainConfig.nativeToken,
    amount: weiToUnits(value, chainConfig.nativeDecimals),
    confirmed: true,
    confirmations,
  };
}

// --- Legacy wrapper for backward compatibility ---

export async function verifyEthereumTx(
  txHash: string,
): Promise<VerifiedPayment> {
  return verifyEvmTx("ethereum", txHash);
}

// --- Bitcoin verification ---

export async function verifyBitcoinTx(
  txHash: string,
): Promise<VerifiedPayment> {
  const res = await fetch(`https://mempool.space/api/tx/${txHash}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Bitcoin tx not found: ${txHash}`);
    throw new Error(`mempool.space API error: ${res.status} ${res.statusText}`);
  }

  const tx = (await res.json()) as {
    txid: string;
    vin: Array<{ prevout: { scriptpubkey_address?: string } }>;
    vout: Array<{ scriptpubkey_address?: string; value: number }>;
    status: { confirmed: boolean; block_height?: number };
  };

  // Find matching output
  const ourAddr = ADDRESSES.bitcoin;
  const matchingVout = tx.vout.find(
    (v) => v.scriptpubkey_address === ourAddr,
  );

  if (!matchingVout) {
    throw new Error(
      `Bitcoin tx has no output to our address ${ourAddr}`,
    );
  }

  const satoshis = matchingVout.value;
  const btcAmount = (satoshis / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

  let confirmations = 0;
  if (tx.status.confirmed && tx.status.block_height != null) {
    const tipRes = await fetch("https://mempool.space/api/blocks/tip/height");
    if (tipRes.ok) {
      const tipHeight = Number(await tipRes.text());
      confirmations = tipHeight - tx.status.block_height + 1;
    }
  }

  if (!tx.status.confirmed) {
    throw new Error("Bitcoin tx is not yet confirmed (still in mempool)");
  }

  // Derive sender from first input
  const fromAddress = tx.vin[0]?.prevout?.scriptpubkey_address ?? "unknown";

  return {
    chain: "bitcoin",
    txHash,
    fromAddress,
    token: "BTC",
    amount: btcAmount,
    confirmed: true,
    confirmations,
  };
}

// --- Solana verification ---

async function solanaRpcCall(
  method: string,
  params: unknown[],
): Promise<unknown> {
  const res = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (json.error) throw new Error(`Solana RPC error: ${json.error.message}`);
  return json.result;
}

const USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function verifySolanaTx(
  txHash: string,
): Promise<VerifiedPayment> {
  const result = (await solanaRpcCall("getTransaction", [
    txHash,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ])) as {
    slot: number;
    meta: {
      err: unknown;
      preBalances: number[];
      postBalances: number[];
      preTokenBalances: Array<{
        accountIndex: number;
        mint: string;
        owner: string;
        uiTokenAmount: { uiAmountString: string };
      }>;
      postTokenBalances: Array<{
        accountIndex: number;
        mint: string;
        owner: string;
        uiTokenAmount: { uiAmountString: string };
      }>;
    };
    transaction: {
      message: {
        accountKeys: Array<{ pubkey: string }>;
      };
    };
  } | null;

  if (!result) throw new Error(`Solana tx not found: ${txHash}`);
  if (result.meta.err) {
    throw new Error(`Solana tx failed: ${JSON.stringify(result.meta.err)}`);
  }

  const ourAddr = ADDRESSES.solana;
  const accountKeys = result.transaction.message.accountKeys;

  // Check for SPL USDC transfer
  const preUsdc = result.meta.preTokenBalances.find(
    (b) => b.owner === ourAddr && b.mint === USDC_MINT_SOLANA,
  );
  const postUsdc = result.meta.postTokenBalances.find(
    (b) => b.owner === ourAddr && b.mint === USDC_MINT_SOLANA,
  );

  if (postUsdc) {
    const preBal = preUsdc
      ? parseFloat(preUsdc.uiTokenAmount.uiAmountString)
      : 0;
    const postBal = parseFloat(postUsdc.uiTokenAmount.uiAmountString);
    const diff = postBal - preBal;

    if (diff > 0) {
      // Find sender: any account key that isn't ours and signed the tx
      const fromAddress =
        accountKeys.find((k) => k.pubkey !== ourAddr)?.pubkey ?? "unknown";

      return {
        chain: "solana",
        txHash,
        fromAddress,
        token: "USDC",
        amount: diff.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""),
        confirmed: true,
        confirmations: 0, // Solana finalized = confirmed
      };
    }
  }

  // Check for native SOL transfer
  const ourIndex = accountKeys.findIndex((k) => k.pubkey === ourAddr);
  if (ourIndex === -1) {
    throw new Error(
      `Solana tx does not involve our address ${ourAddr}`,
    );
  }

  const preSol = result.meta.preBalances[ourIndex];
  const postSol = result.meta.postBalances[ourIndex];
  const diffLamports = postSol - preSol;

  if (diffLamports <= 0) {
    throw new Error(
      `Solana tx did not send funds to our address ${ourAddr}`,
    );
  }

  // Convert lamports to SOL (1 SOL = 1e9 lamports)
  const solAmount = (diffLamports / 1e9)
    .toFixed(9)
    .replace(/0+$/, "")
    .replace(/\.$/, "");

  const fromAddress =
    accountKeys.find((k) => k.pubkey !== ourAddr)?.pubkey ?? "unknown";

  return {
    chain: "solana",
    txHash,
    fromAddress,
    token: "SOL",
    amount: solAmount,
    confirmed: true,
    confirmations: 0,
  };
}

// --- Tron verification ---

/** Convert base58 Tron address to hex (41-prefixed) */
function tronAddressToHex(base58Addr: string): string {
  // Base58 decode table
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const char of base58Addr) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(idx);
  }
  // Convert to hex, strip 4-byte checksum (8 hex chars)
  const hex = num.toString(16).padStart(50, "0"); // 25 bytes = 50 hex
  return hex.slice(0, 42); // 21 bytes = 42 hex (41 prefix + 20 byte address)
}

const USDT_CONTRACT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export async function verifyTronTx(
  txHash: string,
): Promise<VerifiedPayment> {
  // Fetch transaction info
  const txRes = await fetch(
    `https://api.trongrid.io/v1/transactions/${txHash}`,
  );
  if (!txRes.ok) {
    throw new Error(`TronGrid API error: ${txRes.status} ${txRes.statusText}`);
  }
  const txData = (await txRes.json()) as {
    data?: Array<{
      txID: string;
      ret: Array<{ contractRet: string }>;
      raw_data: {
        contract: Array<{
          type: string;
          parameter: {
            value: {
              to_address?: string;
              owner_address?: string;
              amount?: number;
              contract_address?: string;
              data?: string;
            };
          };
        }>;
      };
    }>;
  };

  if (!txData.data || txData.data.length === 0) {
    throw new Error(`Tron tx not found: ${txHash}`);
  }

  const tx = txData.data[0];
  const contractRet = tx.ret?.[0]?.contractRet;

  if (contractRet !== "SUCCESS") {
    throw new Error(`Tron tx not confirmed (status: ${contractRet})`);
  }

  const contract = tx.raw_data.contract[0];
  const ourHex = tronAddressToHex(ADDRESSES.tron).toLowerCase();

  // Check for TRC-20 USDT via events
  const eventsRes = await fetch(
    `https://api.trongrid.io/v1/transactions/${txHash}/events`,
  );
  if (eventsRes.ok) {
    const eventsData = (await eventsRes.json()) as {
      data?: Array<{
        event_name: string;
        contract_address: string;
        result: Record<string, string>;
      }>;
    };

    if (eventsData.data) {
      for (const event of eventsData.data) {
        if (event.event_name !== "Transfer") continue;
        if (event.contract_address !== USDT_CONTRACT_TRON) continue;

        const toHex = event.result["to"] || event.result["1"];
        const amountStr = event.result["value"] || event.result["2"];

        if (!toHex || !amountStr) continue;

        // TronGrid event results may have hex or base58 addresses
        const toNorm = toHex.toLowerCase().startsWith("41")
          ? toHex.toLowerCase()
          : toHex.toLowerCase();

        if (toNorm === ourHex || toHex === ADDRESSES.tron) {
          const amount = tokenUnits(BigInt(amountStr), 6);
          const fromHex = event.result["from"] || event.result["0"] || "unknown";

          return {
            chain: "tron",
            txHash,
            fromAddress: fromHex,
            token: "USDT",
            amount,
            confirmed: true,
            confirmations: 0,
          };
        }
      }
    }
  }

  // Native TRX transfer
  if (contract.type !== "TransferContract") {
    throw new Error(
      `Tron tx is not a transfer (type: ${contract.type}) and no matching TRC-20 event found`,
    );
  }

  const toAddr = contract.parameter.value.to_address?.toLowerCase();
  if (toAddr !== ourHex) {
    throw new Error(
      `Tron tx recipient does not match our address ${ADDRESSES.tron}`,
    );
  }

  // Amount in sun → TRX (1 TRX = 1e6 sun)
  const sunAmount = contract.parameter.value.amount ?? 0;
  const trxAmount = (sunAmount / 1e6)
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");

  const fromAddress = contract.parameter.value.owner_address ?? "unknown";

  return {
    chain: "tron",
    txHash,
    fromAddress,
    token: "TRX",
    amount: trxAmount,
    confirmed: true,
    confirmations: 0,
  };
}

// --- Main dispatcher ---

/** Chain name aliases for backward compatibility */
const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum",
  btc: "bitcoin",
  sol: "solana",
  trx: "tron",
  bsc: "bnb",
  matic: "polygon",
  avax: "avalanche",
  op: "optimism",
  arb: "arbitrum",
  ftm: "fantom",
};

/**
 * Validate a transaction hash against the expected per-chain format before it is
 * interpolated into any external API URL. Prevents malformed / path-injecting
 * input from reaching mempool.space, TronGrid, etc.
 */
function assertValidTxHash(chain: string, txHash: string): void {
  const h = txHash.trim();
  const isEvm = chain in EVM_CHAINS;
  if (isEvm) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) {
      throw new Error(`Invalid ${chain} transaction hash format`);
    }
  } else if (chain === "bitcoin" || chain === "tron") {
    if (!/^[0-9a-fA-F]{64}$/.test(h)) {
      throw new Error(`Invalid ${chain} transaction hash format`);
    }
  } else if (chain === "solana") {
    // Base58 signature, typically 87-88 chars
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(h)) {
      throw new Error("Invalid solana transaction signature format");
    }
  }
}

export async function verifyPayment(
  chain: string,
  txHash: string,
): Promise<VerifiedPayment> {
  const normalizedChain = CHAIN_ALIASES[chain.toLowerCase().trim()] ?? chain.toLowerCase().trim();

  assertValidTxHash(normalizedChain, txHash);

  // EVM chains
  if (normalizedChain in EVM_CHAINS) {
    return verifyEvmTx(normalizedChain, txHash);
  }

  // Non-EVM chains
  switch (normalizedChain) {
    case "bitcoin":
      return verifyBitcoinTx(txHash);
    case "solana":
      return verifySolanaTx(txHash);
    case "tron":
      return verifyTronTx(txHash);
    default:
      throw new Error(
        `Unknown chain "${chain}". Supported EVM chains: ${SUPPORTED_EVM_CHAINS.join(", ")}. Also: bitcoin, solana, tron`,
      );
  }
}
