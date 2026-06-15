import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

const CLOSED_CONTRACT_STATUSES = new Set(['sold', 'won', 'lost', 'cancelled']);

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    const normalizedContract = this.normalizeContract(contract);

                    this.setContractFlags(normalizedContract);

                    this.data.contract = normalizedContract;

                    broadcastContract({ accountID: api_base.account_info.loginid, ...normalizedContract });

                    if (this.isSold) {
                        this.contractId = '';
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(normalizedContract);
                        contractStatus({
                            id: 'contract.sold',
                            data: normalizedContract.transaction_ids?.sell,
                            contract: normalizedContract,
                        });

                        if (this.afterPromise) {
                            this.afterPromise();
                        }

                        this.store.dispatch(sell());
                    } else {
                        this.store.dispatch(openContractReceived());
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick, status } = contract;
            const normalizedStatus = String(status || '').toLowerCase();

            this.isSold = Boolean(is_sold) || CLOSED_CONTRACT_STATUSES.has(normalizedStatus);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        normalizeContract(contract) {
            if (!contract) return contract;

            const normalizedStatus = String(contract.status || '').toLowerCase();
            if (contract.is_sold || !CLOSED_CONTRACT_STATUSES.has(normalizedStatus)) {
                return contract;
            }

            // Some accounts report the final state via status before toggling is_sold.
            // Normalize that shape so the bot and UI can advance consistently.
            return {
                ...contract,
                is_sold: 1,
            };
        }

        expectedContractId(contractId) {
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
