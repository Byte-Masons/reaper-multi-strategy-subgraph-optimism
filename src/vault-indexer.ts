import { Address, BigInt } from "@graphprotocol/graph-ts"
import { StrategyAdded } from "../generated/ReaperVaultERC4626/ReaperVaultERC4626"
import { Vault, Strategy } from "../generated/schema"
import { ReaperVaultERC4626 } from "../generated/templates";

const addStrategyAddresses: Address[] = [
  Address.fromString("0x04C710a1E8a738CDf7cAD3a52Ba77A784C35d8CE"), // super-admin multisig
  Address.fromString("0xe1610bB38Ce95254dD77cbC82F9c1148569B560e"), // goober
  Address.fromString("0x950b0E7FD95a08C9525bC82AaE0A8121cC84143E"), // zokunei
  Address.fromString("0x6539519E69343535a2aF6583D9BAE3AD74c6A293"), // degenicus
  // ... add other addresses that may call addStrategy on a new or existing vault 
];

export function handleStrategyAdded(event: StrategyAdded): void {
  // Ignore event if TX was not from a registered address
  const sender = event.transaction.from;
  if (!addStrategyAddresses.includes(sender)) {
    return;
  }

  // If vault entity does not exist:
  //  1. create new data source for vault
  //  2. save vault entity
  //  3. save new strategy entity
  // Steps 2 and 3 may be unnecessary, if, as the docs say, a new data source will also
  // process the calls and events for the block in which it was created.
  //
  // If vault entity already exists, it means that the vault data source must also exist.
  // In that case, we don't do anything here since the vault data source would trigger its own
  // event handlers.
  const vaultAddress = event.address.toHexString();
  let vaultEntity = Vault.load(vaultAddress);
  if (vaultEntity == null) {
    ReaperVaultERC4626.create(event.address);

    // vaultEntity = new Vault(vaultAddress);
    // vaultEntity.nrOfStrategies = BigInt.fromI32(1);
    // vaultEntity.save();

    // const strategyEntity = new Strategy(event.params.strategy.toHexString());
    // strategyEntity.vault = vaultAddress;
    // strategyEntity.save();
  }
}
