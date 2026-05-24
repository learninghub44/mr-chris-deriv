import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import Text from '@/components/shared_ui/text';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { Localize } from '@deriv-com/translations';
import { TAccountSwitcher } from './common/types';
import AccountInfoWrapper from './account-info-wrapper';
import './account-switcher.scss';

const CURRENCY_NAMES: Record<string, string> = {
    AUD: 'Australian Dollar',
    BTC: 'Bitcoin',
    ETH: 'Ether',
    EUR: 'Euro',
    GBP: 'Pound Sterling',
    LTC: 'Litecoin',
    USD: 'US Dollar',
    USDC: 'USD Coin',
    UST: 'Tether Omni',
    EUSDT: 'Tether ERC20',
    TUSDT: 'Tether TRC20',
};

const getCurrencyName = (currency?: string) => CURRENCY_NAMES[currency?.toUpperCase() ?? ''] ?? currency ?? 'Account';

const AccountSwitcher = observer(({ activeAccount }: TAccountSwitcher) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { accountList, activeLoginid } = useApiBase();
    const { client, run_panel } = useStore() ?? {};

    const is_bot_running = run_panel?.is_running || api_base.is_running;
    const isSingleAccount = !accountList || accountList.length <= 1;

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const toggleDropdown = useCallback(() => {
        if (is_bot_running || isSingleAccount) return;
        setIsOpen(prev => !prev);
    }, [is_bot_running, isSingleAccount]);

    const handleAccountSelect = useCallback(
        (loginid: string) => {
            localStorage.setItem('active_loginid', loginid);
            localStorage.setItem('account_type', isDemoAccount(loginid) ? 'demo' : 'real');

            const accountsListRaw = localStorage.getItem('accountsList');
            if (accountsListRaw) {
                try {
                    const accountsList = JSON.parse(accountsListRaw) as Record<string, string>;
                    if (accountsList[loginid]) localStorage.setItem('authToken', accountsList[loginid]);
                } catch (error) {
                    console.error('[AccountSwitcher] Failed to update legacy auth token:', error);
                }
            }

            client?.checkAndRegenerateWebSocket();
            setIsOpen(false);
        },
        [client]
    );

    const formattedAccounts = useMemo(() => {
        if (!accountList) return [];
        return accountList
            .map(account => ({
                loginid: account.loginid,
                currency: account.currency,
                balance: addComma(Number(account.balance ?? 0).toFixed(getDecimalPlaces(account.currency))),
                isVirtual: isDemoAccount(account.loginid),
                isActive: account.loginid === activeLoginid,
            }))
            .sort((a, b) => (a.isActive ? -1 : b.isActive ? 1 : 0));
    }, [accountList, activeLoginid]);

    if (!activeAccount) return null;

    const { currency, isVirtual, balance } = activeAccount;
    const showChevron = !isSingleAccount && !is_bot_running;
    const realAccounts = formattedAccounts.filter(account => !account.isVirtual);
    const demoAccounts = formattedAccounts.filter(account => account.isVirtual);

    return (
        <div className='acc-info__wrapper' ref={wrapperRef}>
            <AccountInfoWrapper>
                <button className='acc-info__currency-button' type='button' disabled>
                    {getCurrencyDisplayCode(currency || 'USD')}
                    <svg width='10' height='10' viewBox='0 0 10 10' fill='none' aria-hidden='true'>
                        <path d='M2 3.5L5 6.5L8 3.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
                    </svg>
                </button>
                <div
                    data-testid='dt_acc_info'
                    id='dt_core_account-info_acc-info'
                    role={showChevron ? 'button' : undefined}
                    tabIndex={showChevron ? 0 : -1}
                    aria-expanded={showChevron ? isOpen : undefined}
                    aria-haspopup={showChevron ? 'listbox' : undefined}
                    className={classNames('acc-info', {
                        'acc-info--is-virtual': isVirtual,
                        'acc-info--interactive': showChevron,
                    })}
                    onClick={toggleDropdown}
                    onKeyDown={e => {
                        if (showChevron && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    }}
                >
                    <span className='acc-info__id' aria-hidden='true'>
                        <CurrencyIcon currency={currency?.toLowerCase()} isVirtual={isVirtual} />
                    </span>
                    <div className='acc-info__content'>
                        {(typeof balance !== 'undefined' || !currency) && (
                            <div className='acc-info__balance-section'>
                                <p
                                    data-testid='dt_balance'
                                    className={classNames('acc-info__balance', {
                                        'acc-info__balance--no-currency': !currency && !isVirtual,
                                    })}
                                >
                                    {!currency ? (
                                        <Localize i18n_default_text='No currency assigned' />
                                    ) : (
                                        `${balance} ${getCurrencyDisplayCode(currency)}`
                                    )}
                                </p>
                            </div>
                        )}
                    </div>
                    {showChevron && (
                        <span
                            className={classNames('acc-info__select-arrow', {
                                'acc-info__select-arrow--invert': isOpen,
                            })}
                        >
                            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                                <path
                                    d='M3 5L7 9L11 5'
                                    stroke='currentColor'
                                    strokeWidth='1.8'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                />
                            </svg>
                        </span>
                    )}
                </div>
            </AccountInfoWrapper>
            {isOpen && (
                <div className='acc-dropdown' role='listbox'>
                    <div className='acc-dropdown__tabs' role='tablist'>
                        <span className='acc-dropdown__tab acc-dropdown__tab--active'>Real</span>
                        <span className='acc-dropdown__tab'>Demo</span>
                    </div>
                    {realAccounts.length > 0 && (
                        <div className='acc-dropdown__group'>
                            <div className='acc-dropdown__group-title'>
                                <span>Deriv accounts</span>
                                <span className='acc-dropdown__group-chevron' aria-hidden='true'>
                                    ^
                                </span>
                            </div>
                            {realAccounts.map(account => (
                                <div
                                    key={account.loginid}
                                    role='option'
                                    aria-selected={account.isActive}
                                    tabIndex={0}
                                    className={classNames('acc-dropdown__account', {
                                        'acc-dropdown__account--selected': account.isActive,
                                    })}
                                    onClick={() => !account.isActive && handleAccountSelect(account.loginid)}
                                    onKeyDown={e => {
                                        if (!account.isActive && (e.key === 'Enter' || e.key === ' ')) {
                                            e.preventDefault();
                                            handleAccountSelect(account.loginid);
                                        }
                                    }}
                                >
                                    <span className='acc-dropdown__account-icon'>
                                        <CurrencyIcon currency={account.currency?.toLowerCase()} />
                                    </span>
                                    <span className='acc-dropdown__account-info'>
                                        <Text as='span' size='xs' weight='bold' className='acc-dropdown__currency'>
                                            {getCurrencyName(account.currency)}
                                        </Text>
                                        <Text as='span' size='xxxs' className='acc-dropdown__loginid'>
                                            {account.loginid}
                                        </Text>
                                    </span>
                                    <Text as='span' size='xs' weight='bold' className='acc-dropdown__balance'>
                                        {account.currency ? (
                                            `${account.balance} ${getCurrencyDisplayCode(account.currency)}`
                                        ) : (
                                            <Localize i18n_default_text='No currency assigned' />
                                        )}
                                    </Text>
                                </div>
                            ))}
                        </div>
                    )}
                    {demoAccounts.length > 0 && (
                        <div className='acc-dropdown__group'>
                            {demoAccounts.map(account => (
                                <div
                                    key={account.loginid}
                                    role='option'
                                    aria-selected={account.isActive}
                                    tabIndex={0}
                                    className={classNames('acc-dropdown__account', {
                                        'acc-dropdown__account--selected': account.isActive,
                                    })}
                                    onClick={() => !account.isActive && handleAccountSelect(account.loginid)}
                                >
                                    <span className='acc-dropdown__account-icon'>
                                        <CurrencyIcon currency={account.currency?.toLowerCase()} isVirtual />
                                    </span>
                                    <span className='acc-dropdown__account-info'>
                                        <Text as='span' size='xs' weight='bold' className='acc-dropdown__currency'>
                                            Demo
                                        </Text>
                                        <Text as='span' size='xxxs' className='acc-dropdown__loginid'>
                                            {account.loginid}
                                        </Text>
                                    </span>
                                    <Text as='span' size='xs' weight='bold' className='acc-dropdown__balance'>
                                        {account.balance} {getCurrencyDisplayCode(account.currency)}
                                    </Text>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className='acc-dropdown__traders-hub'>Looking for CFD accounts? Go to Trader&apos;s Hub</div>
                    <div className='acc-dropdown__footer'>
                        <button className='acc-dropdown__manage' type='button'>
                            Manage accounts
                        </button>
                        <button className='acc-dropdown__logout' type='button' onClick={() => client?.logout()}>
                            Logout
                            <svg width='16' height='16' viewBox='0 0 16 16' fill='none' aria-hidden='true'>
                                <path
                                    d='M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H6M10 5l3 3-3 3M13 8H5'
                                    stroke='currentColor'
                                    strokeWidth='1.4'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

export default AccountSwitcher;
