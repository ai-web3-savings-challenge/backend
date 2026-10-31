import { ethers } from "ethers";

/* ============================================================
   PARTICIPANTS: EDIT THESE TWO FUNCTIONS

   The backend calls them when your wallet's goal or contribution
   shows up on the SavingsGoal contract. You trigger these from the
   frontend (Set Goal and Record Contribution). Nothing to do here
   except use the values.

   Replace the console.log with your own logic: save the data to a
   database, build your own /goal and /transactions endpoints, send
   it to the AI endpoint, and so on.

   Only events from the wallet in WALLET_ADDRESS (.env) arrive here.
   Amounts have no currency on-chain. In this project they are whole
   naira (100000 means NGN 100,000).
   ============================================================ */

// A goal was set from your wallet.
// goal = {
//   event: "GoalCreated",
//   wallet: "0xA272...24E0",
//   targetAmount: 2000000,
//   targetDate: "2027-01-01",      // real date, converted from the on-chain Unix time
//   targetDateUnix: 1798761600,    // the original on-chain value
//   recordedAt: "2026-10-31T10:15:00.000Z",
//   blockNumber: 39950561,
//   txHash: "0x...",
//   explorerUrl: "https://celo-sepolia.blockscout.com/tx/0x..."
// }
// Setting a goal again replaces the old one and resets the total to 0.
export async function onGoalCreated(goal) {
  console.log("Goal created:", goal);
}

// A contribution was recorded from your wallet.
// contribution = {
//   event: "ContributionRecorded",
//   wallet: "0xA272...24E0",
//   amount: 100000,                // this contribution
//   totalContributed: 100000,      // your running total on-chain
//   date: "2026-10-31",            // taken from the block time
//   recordedAt: "2026-10-31T10:20:00.000Z",
//   blockNumber: 39950817,
//   txHash: "0x...",
//   explorerUrl: "https://celo-sepolia.blockscout.com/tx/0x..."
// }
export async function onContributionRecorded(contribution) {
  console.log("Contribution recorded:", contribution);
}

/* ============================================================
   END OF THE PART YOU EDIT. Everything below reads the chain
   and prepares the values above.
   ============================================================ */

const ABI = [
  "event GoalCreated(address indexed user, uint256 targetAmount, uint256 targetDate)",
  "event ContributionRecorded(address indexed user, uint256 amount, uint256 totalContributed)",
];

const EXPLORER = "https://celo-sepolia.blockscout.com";
const POLL_MS = 5000;   // check for new events every 5 seconds
const CHUNK = 2000;     // blocks read per request (public nodes limit this)

// Unix seconds to "YYYY-MM-DD"
const toDate = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

export async function startEventListener() {
  const { CELO_RPC_URL, CONTRACT_ADDRESS, WALLET_ADDRESS, EVENTS_FROM_BLOCK } = process.env;

  if (!CELO_RPC_URL || !CONTRACT_ADDRESS) {
    console.warn("Event listener is off: set CELO_RPC_URL and CONTRACT_ADDRESS in .env");
    return;
  }
  if (!WALLET_ADDRESS || !ethers.isAddress(WALLET_ADDRESS)) {
    console.warn("Event listener is off: set WALLET_ADDRESS in .env to your own wallet address");
    return;
  }

  try {
    // Read-only connection: no private key, nothing can be sent
    const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

    // Only events from YOUR wallet (the contract marks "user" as indexed, so the node can filter)
    const goalFilter = contract.filters.GoalCreated(WALLET_ADDRESS);
    const contributionFilter = contract.filters.ContributionRecorded(WALLET_ADDRESS);

    // Where to start reading
    const latest = await provider.getBlockNumber();
    let nextBlock =
      EVENTS_FROM_BLOCK && EVENTS_FROM_BLOCK !== "latest" && Number.isInteger(Number(EVENTS_FROM_BLOCK))
        ? Number(EVENTS_FROM_BLOCK)
        : latest + 1;

    console.log(`Event listener on. Wallet: ${WALLET_ADDRESS}. Reading from block ${nextBlock}.`);

    // The contribution event has no date, so we take it from its block (each block asked once)
    const blockTimes = new Map();
    async function blockTime(blockNumber) {
      if (!blockTimes.has(blockNumber)) {
        const block = await provider.getBlock(blockNumber);
        blockTimes.set(blockNumber, block.timestamp);
      }
      return blockTimes.get(blockNumber);
    }

    // Turn a raw log into a clean object and hand it to the right function
    async function handle(log) {
      try {
        const unix = await blockTime(log.blockNumber);
        const base = {
          event: log.eventName,
          wallet: log.args.user,
          recordedAt: new Date(unix * 1000).toISOString(),
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          explorerUrl: `${EXPLORER}/tx/${log.transactionHash}`,
        };

        if (log.eventName === "GoalCreated") {
          const targetDateUnix = Number(log.args.targetDate);
          await onGoalCreated({
            ...base,
            targetAmount: Number(log.args.targetAmount),
            targetDate: toDate(targetDateUnix),
            targetDateUnix,
          });
        } else if (log.eventName === "ContributionRecorded") {
          await onContributionRecorded({
            ...base,
            amount: Number(log.args.amount),
            totalContributed: Number(log.args.totalContributed),
            date: toDate(unix),
          });
        }
      } catch (err) {
        // A bug in your own code above must not stop the listener
        console.error(`Error while handling ${log.eventName}:`, err.message);
      }
    }

    async function poll() {
      try {
        const head = await provider.getBlockNumber();
        while (nextBlock <= head) {
          const to = Math.min(nextBlock + CHUNK - 1, head);
          const goals = await contract.queryFilter(goalFilter, nextBlock, to);
          const contributions = await contract.queryFilter(contributionFilter, nextBlock, to);

          // Handle in the order they happened on-chain
          const all = [...goals, ...contributions].sort(
            (a, b) => a.blockNumber - b.blockNumber || a.index - b.index
          );
          for (const log of all) await handle(log);

          nextBlock = to + 1;
        }
      } catch (err) {
        console.error("Event check failed (will retry):", err.message);
      } finally {
        setTimeout(poll, POLL_MS);
      }
    }

    poll();
  } catch (err) {
    console.error("Event listener could not start:", err.message);
  }
}