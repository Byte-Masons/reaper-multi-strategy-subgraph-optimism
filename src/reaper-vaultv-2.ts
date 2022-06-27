import { Address, log, BigInt, ethereum, Bytes, BigDecimal } from "@graphprotocol/graph-ts"
import {
  StrategyAdded,
  StrategyReported,
  ReaperVaultV2
} from "../generated/ReaperVaultV2/ReaperVaultV2"
import {
  ReaperStrategyScreamLeverage as StrategyContract
} from "../generated/ReaperVaultV2/ReaperStrategyScreamLeverage"
import { Vault, Strategy, StrategyReport, StrategyReportResult } from "../generated/schema"

const BIGINT_ZERO = BigInt.fromI32(0);
const BIGDECIMAL_ZERO = new BigDecimal(BIGINT_ZERO);
const MS_PER_DAY = new BigDecimal(BigInt.fromI32(24 * 60 * 60 * 1000));
const DAYS_PER_YEAR = new BigDecimal(BigInt.fromI32(365));
const BPS_UNIT = BigInt.fromI32(10000);

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

export function handleStrategyReported(event: StrategyReported): void {

  log.info('handleStrategyReported called', []);

  const params = event.params;
  const strategyId = params.strategy.toHexString();
  const roi = params.roi;
  const repayment = params.repayment;
  const gains = params.gains;
  const losses = params.losses;
  const allocated = params.allocated;
  const allocBPS = params.allocBPS;

  log.info('handleStrategyReported strategy {} roi {} repayment {} gains {} losses {} allocated {} allocBPS {}', [
    strategyId,
    roi.toString(),
    repayment.toString(),
    gains.toString(),
    losses.toString(),
    allocated.toString(),
    allocBPS.toString()
  ]);

  const strategy = Strategy.load(strategyId);
  if (strategy !== null) {
    let currentReportId = strategy.latestReport;
    log.info(
      '[Strategy] Getting current report {} for strategy {}.',
      [currentReportId ? currentReportId : 'null', strategy.id]
    );
    let strategyReportId = buildIdFromEvent(event);
    let strategyReport = StrategyReport.load(strategyReportId);
    if (strategyReport === null) {
        log.info(
          'strategyReport === null',
          []
        );
        strategyReport = new StrategyReport(strategyReportId);
        strategyReport.roi = roi;
        strategyReport.repayment = repayment;
        strategyReport.strategy = strategy.id;
        strategyReport.timestamp = getTimestampInMillis(event.block);
        strategyReport.gains = gains;
        strategyReport.losses = losses;
        strategyReport.allocated = allocated;
        strategyReport.allocBPS = allocBPS;
        strategyReport.save();
    }
    strategy.latestReport = strategyReport.id;
    strategy.save();
    // Getting latest report to compare to the new one and create a new report result.
    if (currentReportId !== null) {
      let currentReport = StrategyReport.load(currentReportId);
      if (currentReport !== null) {
        log.info(
          '[Strategy] Create report result (latest {} vs current {}) for strategy {}.',
          [strategyReport.id, currentReport.id, strategyId]
        );
        createStrategyReportResult(currentReport, strategyReport, event);
        updateVaultAPR(strategy.vault);
      }
    } else {
      log.info(
        '[Strategy] Report result NOT created. Only one report created {} for strategy {}.',
        [strategyReport.id, strategyId]
      );
    }
  } else {
    log.warning(
      '[Strategy] Failed to load strategy {} while handling StrategyReport',
      [strategyId]
    );
  }
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

export function createStrategyReportResult(
  previousReport: StrategyReport,
  currentReport: StrategyReport,
  event: StrategyReported
): void {
  log.info(
    '[StrategyReportResult] Create strategy report result between previous {} and current report {}. Strategy {}',
    [previousReport.id, currentReport.id, currentReport.strategy]
  );

  const timestamp = event.block.timestamp;
  const blockNumber = event.block.number;

  let id = buildIdFromEvent(event);
  let strategyReportResult = new StrategyReportResult(id);
  strategyReportResult.timestamp = timestamp;
  strategyReportResult.blockNumber = blockNumber;
  strategyReportResult.currentReport = currentReport.id;
  strategyReportResult.previousReport = previousReport.id;
  strategyReportResult.startTimestamp = previousReport.timestamp;
  strategyReportResult.endTimestamp = currentReport.timestamp;
  strategyReportResult.duration = currentReport.timestamp
    .toBigDecimal()
    .minus(previousReport.timestamp.toBigDecimal());
  strategyReportResult.durationPr = BIGDECIMAL_ZERO;
  strategyReportResult.apr = BIGDECIMAL_ZERO;

  const profit = currentReport.gains.minus(previousReport.gains);
  const msInDays = strategyReportResult.duration.div(MS_PER_DAY);
  log.info(
    '[StrategyReportResult] Report Result - Start / End: {} / {} - Duration: {} (days {}) - Profit: {}',
    [
      strategyReportResult.startTimestamp.toString(),
      strategyReportResult.endTimestamp.toString(),
      strategyReportResult.duration.toString(),
      msInDays.toString(),
      profit.toString()
    ]
  );

  if (!previousReport.allocated.isZero() && !msInDays.equals(BIGDECIMAL_ZERO)) {
    let profitOverTotalDebt = profit
      .toBigDecimal()
      .div(previousReport.allocated.toBigDecimal());
    strategyReportResult.durationPr = profitOverTotalDebt;
    let yearOverDuration = DAYS_PER_YEAR.div(msInDays);
    let apr = profitOverTotalDebt.times(yearOverDuration);

    log.info(
      '[StrategyReportResult] Report Result - Duration: {} ms / {} days - Duration (Year): {} - Profit / Total Debt: {} / APR: {}',
      [
        strategyReportResult.duration.toString(),
        msInDays.toString(),
        yearOverDuration.toString(),
        profitOverTotalDebt.toString(),
        apr.toString(),
      ]
    );
    strategyReportResult.apr = apr;
  }
  strategyReportResult.save();
}

export function updateVaultAPR(vaultAddress: string): void {
  log.info('updateVaultAPR - vaultAddress: {}', [vaultAddress]);
  let vaultContract = ReaperVaultV2.bind(Address.fromString(vaultAddress));
  const nrOfStrategies = vaultContract.withdrawalQueue.length;
  log.info('updateVaultAPR - nrOfStrategies: {}', [nrOfStrategies.toString()]);
  for (let index = 0; index < nrOfStrategies; index++) {
    const strategyAddress = vaultContract.withdrawalQueue(BigInt.fromI32(index));
    //const strategyContract = StrategyContract.bind(strategyAddress);
    const strategy = Strategy.load(strategyAddress.toString());
    if (strategy) {
      
      const strategyParams = vaultContract.strategies(strategyAddress);
      const allocation = strategyParams.getAllocBPS();
      const reportId = strategy.latestReport;
      if (reportId) {
        const report = StrategyReport.load(reportId);
        if (report) {
          // StrategyReportResult.
          // report.
          // log.info('updateVaultAPR - strategy: {} - allocation: {}', [strategyAddress.toString(), allocation.toString()]);
        }
      }
      
      
    }
    //log.info('updateVaultAPR - strategy: {}', [strategy]);
  }
}

// make a derived ID from transaction hash and big number
export function buildId(tx: Bytes, n: BigInt): string {
  return tx.toHexString().concat('-').concat(n.toString());
}

export function buildIdFromEvent(event: ethereum.Event): string {
  return buildId(event.transaction.hash, event.logIndex);
}

export function getTimestampInMillis(block: ethereum.Block): BigInt {
  return block.timestamp.times(BigInt.fromI32(1000));
}