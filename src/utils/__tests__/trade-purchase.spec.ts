const mockSend = jest.fn();
const mockEmit = jest.fn();
const mockGetState = jest.fn();

jest.mock('@/external/bot-skeleton', () => ({
    api_base: {
        is_authorized: true,
        api: {
            send: (...args: unknown[]) => mockSend(...args),
        },
    },
    observer: {
        emit: (...args: unknown[]) => mockEmit(...args),
        getState: (...args: unknown[]) => mockGetState(...args),
    },
}));

jest.mock('@/utils/api-token-permissions', () => ({
    assertApiTokenScope: jest.fn(),
}));

import { buyContractForUi } from '../trade-purchase';

describe('buyContractForUi', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetState.mockImplementation(key => {
            if (key !== 'client.store') return undefined;

            return {
                loginid: 'VRTC123456',
                currency: 'USD',
                getAccountCurrency: () => 'USD',
                getDisplayBalanceAmount: () => 20,
                hasSufficientDemoBalance: (amount: number) => amount <= 20,
            };
        });
    });

    it('blocks demo purchases that exceed the available displayed balance', async () => {
        mockSend.mockResolvedValueOnce({
            proposal: {
                id: 'proposal-1',
                ask_price: 25,
            },
        });

        await expect(
            buyContractForUi({
                parameters: {
                    contract_type: 'CALL',
                    duration: 1,
                    duration_unit: 't',
                    symbol: 'R_10',
                },
                price: 25,
                source: 'Auto Trades',
            })
        ).rejects.toThrow(
            'Auto Trades could not purchase this contract. Insufficient demo balance: available 20.00 USD, required 25.00 USD.'
        );

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                proposal: 1,
                contract_type: 'CALL',
            })
        );
    });

    it('allows demo purchases when the displayed balance covers the contract cost', async () => {
        mockSend
            .mockResolvedValueOnce({
                proposal: {
                    id: 'proposal-2',
                    ask_price: 15,
                },
            })
            .mockResolvedValueOnce({
                buy: {
                    contract_id: 42,
                    transaction_id: 99,
                    buy_price: 15,
                },
            });

        await expect(
            buyContractForUi({
                parameters: {
                    contract_type: 'CALL',
                    duration: 1,
                    duration_unit: 't',
                    symbol: 'R_10',
                },
                price: 15,
                source: 'Auto Trades',
            })
        ).resolves.toEqual(
            expect.objectContaining({
                contract_id: 42,
                transaction_id: 99,
                buy_price: 15,
            })
        );

        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(mockSend).toHaveBeenLastCalledWith({ buy: 'proposal-2', price: 15 });
    });
});
