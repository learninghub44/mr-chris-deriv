import { getValidatedBuyResponse } from '../purchase-utils';

describe('getValidatedBuyResponse', () => {
    it('returns the buy payload when present', () => {
        const buy = { contract_id: 123, transaction_id: 456 };

        expect(getValidatedBuyResponse({ buy }, 'CALL')).toBe(buy);
    });

    it('throws a readable error when buy is missing', () => {
        expect(() => getValidatedBuyResponse({}, 'DIGITOVER')).toThrow(
            'Bot Builder could not confirm the DIGITOVER purchase because Deriv did not return a buy response.'
        );
    });
});
