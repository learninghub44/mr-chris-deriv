import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { getBestBotsFileUrl, getBestBotsFolder } from '@/components/shared';
import { DBOT_TABS } from '@/constants/bot-contents';
import { load, save_types } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { API_BASE } from '@/utils/api-base';
import { setActiveBot } from '@/utils/bot-tracker';
import './best-bots.scss';

type TBot = {
    id: string;
    name: string;
    file: string;
    description: string;
    emoji: string;
};

type TBotStats = {
    bot_id: string;
    total_runs: number;
    profits: number;
    losses: number;
    profit_amount?: number | string | null;
    loss_amount?: number | string | null;
};

const MIN_RUNS_FOR_RATING = 3;
const DEVELOPER_DISPLAY_NAME = 'Mr Duke';

const formatMoney = (value: number | string | null | undefined) => {
    const n = Number(value || 0);
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
};

const computeStars = (profits: number, losses: number) => {
    const total = (profits || 0) + (losses || 0);
    if (total < MIN_RUNS_FOR_RATING) return 0;
    const rate = profits / total;
    if (rate >= 0.8) return 5;
    if (rate >= 0.6) return 4;
    if (rate >= 0.4) return 3;
    if (rate >= 0.2) return 2;
    return 1;
};

const StarRating = ({ profits, losses }: { profits: number; losses: number }) => {
    const stars = computeStars(profits, losses);
    if (stars === 0) {
        return <span className='bb-card__rating bb-card__rating--new'>New – not enough runs</span>;
    }
    return (
        <span className='bb-card__rating' title={`${stars} out of 5`}>
            {Array.from({ length: 5 }, (_, i) => (
                <span
                    key={i}
                    className={`bb-card__star${i < stars ? ' bb-card__star--filled' : ''}`}
                    aria-hidden='true'
                >
                    ★
                </span>
            ))}
            <span className='bb-card__rating-value'>{stars}/5</span>
        </span>
    );
};

const RISK_MANAGERS_BOTS: TBot[] = [
    {
        id: 'd1',
        name: 'D1-BY MR.DUKE(+254702490526)',
        file: 'D1-BY MR.DUKE(+254702490526).xml',
        description: 'Classic Deriv bot with consistent, reliable performance across markets.',
        emoji: '🔵',
    },
    {
        id: 'd2',
        name: 'D2 BY--MR.DUKE(+254702490526) (1)',
        file: 'D2 BY--MR.DUKE(+254702490526) (1).xml',
        description: 'Enhanced second-generation strategy with improved entry signals.',
        emoji: '⚡',
    },
    {
        id: 'd3',
        name: 'The-D3 rise and fall',
        file: 'The-D3 rise and fall.xml',
        description: 'Trend-following strategy targeting rise and fall market patterns.',
        emoji: '📊',
    },
    {
        id: 'd4',
        name: 'D4 Update by MR.DUKE(+254702490526)FINAL  (%%%)) (1) (1) (1)',
        file: 'D4 Update by MR.DUKE(+254702490526)FINAL  (%%%)) (1) (1) (1).xml',
        description: 'Final polished version of the D-series with multi-market support.',
        emoji: '🏆',
    },
    {
        id: 'd5',
        name: 'D5 (Original version +254702490526)',
        file: 'D5 (Original version +254702490526).xml',
        description: 'The original flagship D5 strategy — time-tested and dependable.',
        emoji: '⭐',
    },
    {
        id: 'd6',
        name: 'D6 Deriv by Duke (1)',
        file: 'D6 Deriv by Duke (1).xml',
        description: 'Deriv-optimised strategy with refined logic for smoother execution.',
        emoji: '🎯',
    },
    {
        id: 'black-devil',
        name: 'BLACK DEVIL v2( By MR. DUKE)',
        file: 'BLACK DEVIL v2( By MR. DUKE).xml',
        description: 'Aggressive scalping strategy with precision entries and tight risk control.',
        emoji: '😈',
    },
    {
        id: 'grffy',
        name: 'grffy',
        file: 'grffy.xml',
        description: 'Volatility-driven strategy with adaptive position sizing.',
        emoji: '🔲',
    },
    {
        id: 'kiazala',
        name: 'Kiazala v1 by The Risk Manager (1)',
        file: 'Kiazala v1 by The Risk Manager (1).xml',
        description: 'Disciplined risk-managed bot designed to protect capital while growing.',
        emoji: '🛡️',
    },
    {
        id: 'kumi',
        name: 'KUMI NA NNE BORA V2  (1) (1)',
        file: 'KUMI NA NNE BORA V2  (1) (1).xml',
        description: 'Multi-step accumulation strategy with layered entry logic.',
        emoji: '📈',
    },
    {
        id: 'mwenda',
        name: 'Mwenda Pole By The Risk Manager (1)',
        file: 'Mwenda Pole By The Risk Manager (1).xml',
        description: 'Slow and steady conservative approach — ideal for low-risk accounts.',
        emoji: '🐢',
    },
    {
        id: 'simba',
        name: 'Simba Ai v1',
        file: 'Simba Ai v1.xml',
        description: 'AI-enhanced strategy combining pattern recognition with smart exits.',
        emoji: '🦁',
    },
    {
        id: 'speedhack',
        name: 'Speedhack by mrduke.site 00 (1)',
        file: 'Speedhack by mrduke.site 00 (1).xml',
        description: 'Ultra-fast tick-based execution for volatile market conditions.',
        emoji: '🚀',
    },
    {
        id: 'under789',
        name: 'under 7,8,9= g2 bot 1==',
        file: 'under 7,8,9= g2 bot 1==.xml',
        description: 'Specialised over/under boundary strategy for digit markets.',
        emoji: '🎲',
    },
    {
        id: 'wealth',
        name: 'Wealth Generator',
        file: 'Wealth Generator.xml',
        description: 'Compound growth strategy built for long-term account building.',
        emoji: '💰',
    },
];

const TERMICA_BOTS: TBot[] = [
    {
        id: 'termica-pro',
        name: 'Termica Pro Bot',
        file: 'D1-BY MR.DUKE(+254702490526).xml',
        description: 'Professional Termica strategy tuned for consistent signal execution.',
        emoji: '🔥',
    },
    {
        id: 'termica-classic',
        name: 'Termica Classic Bot',
        file: 'D2 BY--MR.DUKE(+254702490526) (1).xml',
        description: 'Classic Termica setup with simple, reliable trade logic.',
        emoji: '⭐',
    },
    {
        id: 'termica-rise-fall',
        name: 'Termica Rise & Fall Bot',
        file: 'The-D3 rise and fall.xml',
        description: 'Termica trend strategy focused on rise and fall market moves.',
        emoji: '📊',
    },
    {
        id: 'termica-prime',
        name: 'Termica Prime Bot',
        file: 'D4 Update by MR.DUKE(+254702490526)FINAL  (%%%)) (1) (1) (1).xml',
        description: 'Prime Termica configuration with refined entry conditions.',
        emoji: '🏆',
    },
    {
        id: 'termica-original',
        name: 'Termica Original Bot',
        file: 'D5 (Original version +254702490526).xml',
        description: 'Original Termica-styled strategy for dependable bot loading.',
        emoji: '🔵',
    },
    {
        id: 'termica-fx',
        name: 'Termica FX Bot',
        file: 'D6 Deriv by Duke (1).xml',
        description: 'Termica FX edition with smooth execution for active traders.',
        emoji: '🎯',
    },
    {
        id: 'termica-devil',
        name: 'Termica Devil Bot',
        file: 'BLACK DEVIL v2( By MR. DUKE).xml',
        description: 'Aggressive Termica strategy with fast reaction logic.',
        emoji: '😈',
    },
    {
        id: 'termica-edge',
        name: 'Termica Edge Bot',
        file: 'grffy.xml',
        description: 'Termica edge setup for volatility-based opportunities.',
        emoji: '🔲',
    },
    {
        id: 'termica-shield',
        name: 'Termica Shield Bot',
        file: 'Kiazala v1 by The Risk Manager (1).xml',
        description: 'Risk-aware Termica bot built for disciplined capital protection.',
        emoji: '🛡️',
    },
    {
        id: 'termica-momentum',
        name: 'Termica Momentum Bot',
        file: 'KUMI NA NNE BORA V2  (1) (1).xml',
        description: 'Momentum-focused Termica strategy with layered entries.',
        emoji: '📈',
    },
    {
        id: 'termica-slow',
        name: 'Termica Pole Bot',
        file: 'Mwenda Pole By The Risk Manager (1).xml',
        description: 'Slow and steady Termica setup for conservative execution.',
        emoji: '🐢',
    },
    {
        id: 'termica-ai',
        name: 'Termica AI Bot',
        file: 'Simba Ai v1.xml',
        description: 'AI-styled Termica bot combining pattern logic and smart exits.',
        emoji: '🦁',
    },
    {
        id: 'termica-turbo',
        name: 'Termica Turbo Bot',
        file: 'Speedhack by mrduke.site 00 (1).xml',
        description: 'Fast Termica execution for high-movement market conditions.',
        emoji: '🚀',
    },
    {
        id: 'termica-digit-pro',
        name: 'Termica Digit Pro Bot',
        file: 'under 7,8,9= g2 bot 1==.xml',
        description: 'Termica digit strategy for specialised over/under setups.',
        emoji: '🎲',
    },
    {
        id: 'termica-wealth',
        name: 'Termica Wealth Bot',
        file: 'Wealth Generator.xml',
        description: 'Termica wealth strategy focused on structured account growth.',
        emoji: '💰',
    },
];

const OPTIMUM_BOTS: TBot[] = [
    {
        id: 'dollar-printer-original',
        name: 'Dollar Printer Bot Original',
        file: '$DollarprinterbotOrignal$ (1).xml',
        description: 'Original Dollar Printer strategy tuned for steady returns.',
        emoji: '💵',
    },
    {
        id: 'dollar-printer-2025',
        name: 'Dollar Printer 2025 Version',
        file: '1 2025 $Orginal DollarPrinterBot  2025 Version $ (1).xml',
        description: '2025 refreshed Dollar Printer with updated parameters.',
        emoji: '💵',
    },
    {
        id: 'tick-digit-over-2',
        name: 'Tick Digit Over 2',
        file: '1 tick DIgit Over 2.xml',
        description: 'Specialised digit bot targeting over 2 on ticks.',
        emoji: '🔢',
    },
    {
        id: 'alpha-2025',
        name: 'Alpha Version 2025',
        file: '2025 Alpha Version 2025.xml',
        description: 'Alpha 2025 strategy with fresh market logic.',
        emoji: '🚀',
    },
    {
        id: 'candle-mine-v3-updated',
        name: 'Candle Mine v3 Updated',
        file: '3 Updated Version Of Candle Mine????.xml',
        description: 'Improved Candle Mine strategy for pattern trading.',
        emoji: '🕯️',
    },
    {
        id: 'auto-analysis',
        name: 'Auto Analysis Bot',
        file: 'AUTO ANALYSIS BOT.xml',
        description: 'Automated analysis bot that adapts to market conditions.',
        emoji: '📊',
    },
    {
        id: 'candle-mine-3-1',
        name: 'Candle Mine 3.1',
        file: 'Candle mine version 3.1.xml',
        description: 'Stable Candle Mine release version 3.1.',
        emoji: '🕯️',
    },
    {
        id: 'coolkid',
        name: 'CoolKid Bot',
        file: 'COOLKID.xml',
        description: 'Fun and effective CoolKid trading logic.',
        emoji: '😎',
    },
    {
        id: 'deriv-wizard-1',
        name: 'Deriv Wizard 1',
        file: 'Deriv wizard 1.xml',
        description: 'Wizard-style Deriv bot for reliable execution.',
        emoji: '🧙',
    },
    {
        id: 'digit-hyper',
        name: 'Digit Hyper Bot',
        file: 'Digit hyper.xml',
        description: 'High-speed digit trading bot.',
        emoji: '⚡',
    },
    {
        id: 'even-odd-speed',
        name: 'Even Odd Speed Bot',
        file: 'Even odd speed bot.xml',
        description: 'Fast even/odd market speed strategy.',
        emoji: '🏎️',
    },
    {
        id: 'ezekey-sniper-lite',
        name: 'Ezekey Sniper Lite',
        file: 'Ezekey sniper lite.xml',
        description: 'Lightweight sniper bot for precise entries.',
        emoji: '🎯',
    },
    {
        id: 'falcon',
        name: 'Falcon Bot',
        file: 'FALCON BOT.xml',
        description: 'Aggressive Falcon hunting strategy.',
        emoji: '🦅',
    },
    {
        id: 'gibuu-v8-pro',
        name: 'GIBUU V8 Pro',
        file: 'GIBUU V8 PRO.xml',
        description: 'Pro-grade GIBUU V8 trading system.',
        emoji: '🛡️',
    },
    {
        id: 'hennessy-matrix-v5',
        name: 'Hennessy Matrix V5 Original',
        file: 'HENNESSY?? _MATRIX V5 BOT Orig..xml',
        description: 'Original Hennessy Matrix V5 with matrix logic.',
        emoji: '🔷',
    },
    {
        id: 'kathy-entry-point',
        name: 'Kathy Bot Entry With Point',
        file: 'Kathy bot entry with point.xml',
        description: 'Kathy bot using precise entry points.',
        emoji: '📍',
    },
    {
        id: 'm27-original',
        name: 'M27 Original Version',
        file: 'M27 Original version.xml',
        description: 'Classic M27 original strategy.',
        emoji: '🧩',
    },
    {
        id: 'mask-evenodd',
        name: 'Mask EvenOdd Bot',
        file: 'Mask evenodd bot.xml',
        description: 'Masked even/odd detection bot.',
        emoji: '🎭',
    },
    {
        id: 'mask-matches-speed',
        name: 'Mask Matches Speed Bot',
        file: 'mask matches speed bot ??.xml',
        description: 'Speed-optimised matches/differs mask bot.',
        emoji: '🏃',
    },
    {
        id: 'matches-differs',
        name: 'Matches and Differs Bot',
        file: 'MATCHES AND DIFFERS BOT.xml',
        description: 'Dedicated matches & differs trading bot.',
        emoji: '🔄',
    },
    {
        id: 'mega-pro',
        name: 'Mega Pro Bot',
        file: 'MEGA PRO BOT.xml',
        description: 'High-performance Mega Pro strategy.',
        emoji: '⭐',
    },
    {
        id: 'night-cap-printer',
        name: 'Night Cap Printer Bot',
        file: 'NIGHT  CAP PRINTER BOT.xml',
        description: 'Night-time focused cap printer bot.',
        emoji: '🌙',
    },
    {
        id: 'scaplex-ai-sn4',
        name: 'SCAPLEX AI SN4',
        file: 'SCAPLEX   Ai  SN4 (1) (1).xml',
        description: 'SCAPLEX AI SN4 intelligent trading system.',
        emoji: '🤖',
    },
    {
        id: 'scaucer-speed',
        name: 'Scaucer Speed Bot',
        file: 'SCAUCER SPEED BOT ????.xml',
        description: 'High-velocity Scaucer speed trading bot.',
        emoji: '💨',
    },
    {
        id: 'dollar-pro',
        name: 'The Dollar Pro',
        file: 'THE DOLLAR PRO.xml',
        description: 'Premium Dollar Pro trading strategy.',
        emoji: '💎',
    },
    {
        id: 'trend-lover',
        name: 'The Trend Lover',
        file: 'THE TREND LOVER.xml',
        description: 'Trend-following bot designed for strong moves.',
        emoji: '📈',
    },
    {
        id: 'trade-city-v2-1',
        name: 'Trade City Bot v2.1',
        file: 'TRADE CITY BOT VERSION 2.1.xml',
        description: 'Trade City v2.1 city-style market navigation.',
        emoji: '🏙️',
    },
    {
        id: 'ultra-ai-2025',
        name: 'Ultra AI 2025',
        file: 'ULTRA AI 2025.xml',
        description: 'Ultra AI 2025 next-gen intelligent bot.',
        emoji: '🧠',
    },
];

const BOTS_BY_FOLDER: Record<string, TBot[]> = {
    'riskmanagers.site': RISK_MANAGERS_BOTS,
    'termicafx.site': TERMICA_BOTS,
    'optimumtraders.site': OPTIMUM_BOTS,
};

export const getBestBotsForFolder = (bots_folder: string) => BOTS_BY_FOLDER[bots_folder] ?? [];

const BotCard = observer(({ bot, stats }: { bot: TBot; stats: TBotStats | undefined }) => {
    const { dashboard, toolbar } = useStore();
    const { setActiveTab } = dashboard;
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    const handleLoad = async () => {
        setLoading(true);
        setError(false);
        try {
            const url = getBestBotsFileUrl(bot.file);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const xml_text = await res.text();
            const workspace = window.Blockly?.derivWorkspace;
            if (!workspace) throw new Error('Workspace not ready');
            await load({
                block_string: xml_text,
                file_name: bot.name,
                workspace,
                from: save_types.LOCAL,
                drop_event: {},
                strategy_id: null,
                showIncompatibleStrategyDialog: false,
            });
            setActiveBot('best-bot', bot.id, bot.name);
            try {
                toolbar.setStrategyProtected(true);
            } catch {
                // Keep loading the bot even if toolbar protection is unavailable.
            }
            setTimeout(() => {
                const ws = window.Blockly?.derivWorkspace;
                if (ws) {
                    ws.getAllBlocks(false).forEach((block: any) => {
                        if (['before_purchase', 'after_purchase', 'purchase', 'trade_again'].includes(block.type)) {
                            block.setCollapsed(true);
                        }
                    });
                }
            }, 500);
            setLoaded(true);
            setTimeout(() => setLoaded(false), 3000);
            setActiveTab(DBOT_TABS.BOT_BUILDER);
        } catch {
            setError(true);
            setTimeout(() => setError(false), 4000);
        } finally {
            setLoading(false);
        }
    };

    const totalRuns = stats?.total_runs ?? 0;
    const profits = stats?.profits ?? 0;
    const losses = stats?.losses ?? 0;
    const profitAmount = stats?.profit_amount ?? 0;
    const lossAmount = stats?.loss_amount ?? 0;

    return (
        <div className='bb-card'>
            <span className='bb-card__emoji'>{bot.emoji}</span>
            <h3 className='bb-card__name'>{bot.name}</h3>
            <p className='bb-card__developer'>
                Developed by <strong>{DEVELOPER_DISPLAY_NAME}</strong>
            </p>
            <p className='bb-card__desc'>{bot.description}</p>

            <div className='bb-card__stats'>
                <span className='bb-card__stat bb-card__stat--runs'>🔄 {totalRuns} Runs</span>
                <span className='bb-card__stat bb-card__stat--profit'>
                    ✅ {profits} Wins · +{formatMoney(profitAmount)}
                </span>
                <span className='bb-card__stat bb-card__stat--loss'>
                    ❌ {losses} Losses · -{formatMoney(lossAmount)}
                </span>
            </div>
            <StarRating profits={profits} losses={losses} />

            <button
                className={`bb-card__btn${loaded ? ' bb-card__btn--loaded' : ''}${error ? ' bb-card__btn--error' : ''}`}
                onClick={handleLoad}
                disabled={loading}
            >
                {loading ? 'Loading…' : loaded ? '✓ Loaded to Builder' : error ? '✗ Failed — retry' : 'Load Bot'}
            </button>
        </div>
    );
});

const BestBots = () => {
    const [statsMap, setStatsMap] = useState<Record<string, TBotStats>>({});
    const bots = getBestBotsForFolder(getBestBotsFolder());

    useEffect(() => {
        const loadStats = () => {
            fetch(`${API_BASE}/best-bot-stats`)
                .then(r => r.json())
                .then((rows: TBotStats[]) => {
                    const map: Record<string, TBotStats> = {};
                    rows.forEach(r => {
                        map[r.bot_id] = r;
                    });
                    setStatsMap(map);
                })
                .catch(() => {});
        };
        loadStats();
        const interval = setInterval(loadStats, 30_000);
        return () => clearInterval(interval);
    }, []);

    const rankedBots = [...bots].sort((a, b) => {
        const sa = statsMap[a.id];
        const sb = statsMap[b.id];
        const netA = Number(sa?.profit_amount || 0) - Number(sa?.loss_amount || 0);
        const netB = Number(sb?.profit_amount || 0) - Number(sb?.loss_amount || 0);
        if (netB !== netA) return netB - netA;
        const pa = sa?.profits ?? 0;
        const pb = sb?.profits ?? 0;
        if (pb !== pa) return pb - pa;
        const la = sa?.losses ?? 0;
        const lb = sb?.losses ?? 0;
        return la - lb;
    });

    return (
        <div className='best-bots'>
            <div className='best-bots__grid'>
                {rankedBots.length > 0 ? (
                    rankedBots.map(bot => <BotCard key={bot.id} bot={bot} stats={statsMap[bot.id]} />)
                ) : (
                    <p>No bots configured for this domain yet.</p>
                )}
            </div>
        </div>
    );
};

export default BestBots;
