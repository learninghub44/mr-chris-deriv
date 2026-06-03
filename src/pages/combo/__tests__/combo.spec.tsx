import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import Combo from '../combo';

jest.mock('@/hooks/useStore', () => ({
    useStore: jest.fn(),
}));

jest.mock('@/components/shared_ui/themed-scrollbars', () => ({
    __esModule: true,
    default: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

jest.mock('@/components/shared_ui/input', () => ({
    __esModule: true,
    default: (props: any) => <input {...props} />,
}));

const tickSubscribers: Record<string, (data: any) => void> = {};
const mockApiSubscribe = jest.fn((request: any) => ({
    subscribe: (callback: (data: any) => void) => {
        if (request?.ticks) tickSubscribers[request.ticks] = callback;
        return { unsubscribe: jest.fn() };
    },
}));

jest.mock('@/external/bot-skeleton', () => ({
    api_base: {
        is_authorized: true,
        account_info: { loginid: 'CR12345' },
        api: { subscribe: (...args: unknown[]) => mockApiSubscribe(...args) },
    },
    observer: {
        emit: jest.fn(),
        register: jest.fn(),
        unregister: jest.fn(),
    },
}));

jest.mock('@/utils/trade-purchase', () => ({
    buyContractForUi: jest.fn(),
    emitContractSoldStatus: jest.fn(),
    getContractSnapshot: jest.fn(),
}));

jest.mock('@/stores/condition-notifier-store', () => ({
    conditionNotifierStore: { setCondition: jest.fn() },
}));

const mockUseStore = useStore as jest.Mock;

const createMockStore = () => ({
    dashboard: {
        active_tab: DBOT_TABS.COMBO,
        setActiveTradingModule: jest.fn(),
        registerTradingStopHandler: jest.fn(),
        unregisterTradingStopHandler: jest.fn(),
    },
    client: { currency: 'USD', is_logged_in: true },
    summary_card: { onBotContractEvent: jest.fn() },
    transactions: { pushTransaction: jest.fn() },
    run_panel: {
        run_id: 'run-1',
        is_running: false,
        setIsRunning: jest.fn(),
        setRunId: jest.fn(),
        toggleDrawer: jest.fn(),
        onBotRunningEvent: jest.fn(),
        onContractStatusEvent: jest.fn(),
        onError: jest.fn(),
        onBotContractEvent: jest.fn(),
        SetpurchaseInProgress: jest.fn(),
        onUnmount: jest.fn(),
    },
});

describe('<Combo />', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.keys(tickSubscribers).forEach(symbol => delete tickSubscribers[symbol]);
        localStorage.clear();
        mockUseStore.mockReturnValue(createMockStore());
    });

    it('keeps live quotes flowing after stopping combo trades', async () => {
        const user = userEvent.setup();
        const store = createMockStore();
        mockUseStore.mockReturnValue(store);

        render(<Combo />);

        await waitFor(() => {
            expect(tickSubscribers['1HZ100V']).toBeDefined();
        });

        act(() => {
            tickSubscribers['1HZ100V']({ tick: { quote: 100.22 } });
        });

        await waitFor(() => {
            expect(screen.getByText('100.22')).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: /Run Combo/i }));
        await user.click(screen.getByRole('button', { name: /Stop/i }));

        expect(store.run_panel.onUnmount).not.toHaveBeenCalled();

        act(() => {
            tickSubscribers['1HZ100V']({ tick: { quote: 101.33 } });
        });

        await waitFor(() => {
            expect(screen.getByText('101.33')).toBeInTheDocument();
        });
        expect(screen.getByText('Live data')).toBeInTheDocument();
    });
});
