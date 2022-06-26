import { Address, log } from "@graphprotocol/graph-ts"
import {
  StrategyAdded
} from "../generated/ReaperVaultV2/ReaperVaultV2"
import {
  ReaperStrategyScreamLeverage as StrategyContract
} from "../generated/ReaperVaultV2/ReaperStrategyScreamLeverage"
import { Vault, Strategy } from "../generated/schema"

export function handleStrategyAdded(event: StrategyAdded): void {
  const strategyAddress = event.params.strategy;
  const strategyId = strategyAddress.toHexString();
  let strategyContract = StrategyContract.bind(strategyAddress);
  let vaultAddress = strategyContract.vault();
  log.info('handleStrategyAdded strategy {} in vault {}', [
    strategyId,
    vaultAddress.toHexString()
  ]);
  getOrCreateVault(vaultAddress);
  const strategy = new Strategy(strategyId);
  strategy.vault = vaultAddress.toHexString();
  strategy.save();
}

function getOrCreateVault(vaultAddress: Address): Vault {
  let id = vaultAddress.toHexString();
  log.info('getOrCreateVault {}', [id]);
  let vaultEntity = Vault.load(id);
  if (vaultEntity == null) {
    vaultEntity = new Vault(id);
  }
  vaultEntity.save();
  return vaultEntity;
}